import time
import json
import ntptime
import gc
import network
import _thread
import config
import wifi
import display
import alerts
import cloud
import enroll
import delete
from fingerprint import scan_finger
from display import show_centered

# Set up the network interface to monitor the connection
wlan = network.WLAN(network.STA_IF)

# Protects the backup file, which both threads use
file_lock = _thread.allocate_lock()

RESULT_DISPLAY_MS = 700
POLL_INTERVAL_S = 15
WIFI_RETRY_S = 60
DOUBLE_SCAN_MS = 120000

# time.time() counts from 2000 on some MicroPython builds and 1970 on others
EPOCH_OFFSET = 946684800 if time.gmtime(0)[0] == 2000 else 0

# --- HELPER FUNCTIONS ---
def load_users():
    try:
        with open("employee.json", "r") as f:
            return json.load(f)
    except Exception as e:
        print("⚠️ Could not load employee.json:", e)
        return {}

USERS = load_users()

def clock_is_set():
    # After power-up the clock starts at the year 2000 until the first time sync
    return time.gmtime()[0] >= 2024

def get_datetime():
    ist_epoch = time.time() + 19800
    year, month, day, hour, minute, second, wday, yday = time.localtime(ist_epoch)

    months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    date_str = f"{day:02d}-{months[month]}-{year}"

    ampm = "AM" if hour < 12 else "PM"
    hr12 = hour if hour <= 12 else hour - 12
    if hr12 == 0: hr12 = 12

    lcd_time = f"{hr12:02d}:{minute:02d} {ampm}"
    time_str = f"{hr12:02d}:{minute:02d}:{second:02d} {ampm}"

    return lcd_time, date_str, time_str

def sync_clock():
    for server in ["pool.ntp.org", "time.google.com", "time.windows.com"]:
        ntptime.host = server
        try:
            with cloud.sync_lock:
                ntptime.settime()
            print("🕒 Internal System Clock synced to Internet Time!")
            return True
        except Exception as e:
            print(f"  NTP failed on {server}: {e}")
    return False

# --- LOCAL IN/OUT STATE ---
STATUS_FILE = "status.json"

def load_status():
    try:
        with open(STATUS_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {}

EMP_STATUS = load_status()

def save_status():
    try:
        with open(STATUS_FILE, "w") as f:
            json.dump(EMP_STATUS, f)
    except Exception as e:
        print("⚠️ status save failed:", e)

# --- BACKUP HANDLING ---
# Every scan goes to this file first, so it survives WiFi drops and restarts.
# The background thread uploads the file and removes what has been sent.
def backup_log(finger_id, epoch):
    try:
        with file_lock:
            with open(config.BACKUP_FILE, "a") as f:
                f.write(json.dumps({"finger": finger_id, "epoch": epoch}) + "\n")
        print(f"📝 Saved locally: finger {finger_id} @ {epoch}")
    except Exception as e:
        print("❌ Backup write failed:", e)

def read_backup():
    try:
        with file_lock:
            with open(config.BACKUP_FILE, "r") as f:
                return f.readlines()
    except OSError:
        return []

def remove_from_backup(sent_lines):
    """Removes uploaded lines. Scans added during the upload are kept."""
    with file_lock:
        with open(config.BACKUP_FILE, "r") as f:
            lines = f.readlines()
        remaining = [line for line in lines if line not in sent_lines]
        if remaining:
            with open(config.BACKUP_FILE, "w") as f:
                for line in remaining:
                    f.write(line)
        else:
            import os
            os.remove(config.BACKUP_FILE)

def flush_backup():
    lines = read_backup()
    if not lines:
        return

    sent = []
    try:
        for line in lines:
            try:
                rec = json.loads(line)
                finger_id, epoch = rec["finger"], rec["epoch"]
            except (ValueError, KeyError):
                # Older record from the Google Sheet version. Left in the file.
                continue
            result = cloud.send_scan(finger_id, epoch)
            if not result.get("ok"):
                print("  Dropped scan:", result.get("reason"))
            sent.append(line)
            gc.collect()
    except Exception as e:
        print("❌ Upload stopped, keeping the rest:", e)

    if sent:
        try:
            remove_from_backup(sent)
            print(f"✅ Uploaded {len(sent)} scan(s).")
        except Exception as e:
            print("Backup cleanup failed:", e)

# --- STAFF LIST ---
def refresh_staff():
    global USERS
    result = cloud.get_staff()
    staff = result.get("staff") or {}
    if not staff:
        return
    staff["_version"] = result.get("staff_version")
    with open("employee.json", "w") as f:
        json.dump(staff, f)
    USERS = staff
    print(f"👥 Staff list updated ({len(staff) - 1} people).")

# --- BACKGROUND THREAD ---
# All normal network work happens here, so scanning is never held up by it.
pending_command = None
worker_paused = False

def worker():
    global pending_command
    last_poll_ms = time.ticks_ms() - POLL_INTERVAL_S * 1000
    last_wifi_ms = time.ticks_ms()

    while True:
        time.sleep(1)
        if worker_paused:
            continue

        now_ms = time.ticks_ms()
        try:
            if not wlan.isconnected():
                if time.ticks_diff(now_ms, last_wifi_ms) > WIFI_RETRY_S * 1000:
                    last_wifi_ms = now_ms
                    print("🔄 Attempting to reconnect WiFi...")
                    wlan.connect(config.WIFI_SSID, config.WIFI_PASSWORD)
                continue

            if not clock_is_set():
                sync_clock()
                continue

            flush_backup()

            if time.ticks_diff(now_ms, last_poll_ms) > POLL_INTERVAL_S * 1000:
                last_poll_ms = now_ms
                result = cloud.poll()
                if result.get("staff_version") != USERS.get("_version"):
                    refresh_staff()
                if result.get("command") and pending_command is None:
                    pending_command = result["command"]
        except Exception as e:
            print("⚠️ Background task failed:", e)
        gc.collect()

# --- JOBS SENT FROM THE APP ---
ENROLL_STEPS = {
    "place": ("Place finger", "on sensor"),
    "lift": ("Lift finger", ""),
    "again": ("Place same", "finger again"),
    "saving": ("Saving...", ""),
}

def run_enroll(command):
    command_id = command["id"]

    def on_step(step):
        line1, line2 = ENROLL_STEPS[step]
        show_centered(line1, 0)
        show_centered(line2, 1)
        try:
            cloud.update_command(command_id, "running", step)
        except Exception as e:
            print("⚠️ Could not report step:", e)

    show_centered("Registering", 0)
    show_centered(command.get("name") or "", 1)
    time.sleep(2)

    error = enroll.enroll_finger(command["finger_id"], on_step)
    if error:
        show_centered("Failed", 0)
        show_centered("Try again", 1)
        alerts.error_beep()
        cloud.update_command(command_id, "failed", None, error)
    else:
        show_centered("Registered!", 0)
        show_centered(command.get("name") or "", 1)
        alerts.success_beep()
        cloud.update_command(command_id, "done", "done")
    time.sleep(2)

def run_delete(command):
    if delete.delete_finger(command["finger_id"]):
        cloud.update_command(command["id"], "done")
    else:
        cloud.update_command(command["id"], "failed", None, "Sensor could not delete this fingerprint")

def run_command(command):
    global worker_paused
    worker_paused = True
    try:
        if command["kind"] == "enroll":
            run_enroll(command)
        elif command["kind"] == "delete":
            run_delete(command)
    except Exception as e:
        print("❌ Job failed:", e)
    worker_paused = False
    display.show_ready()

# ==========================================
# 1. SYSTEM INITIALIZATION & NTP SYNC
# ==========================================
print("=== ESP32 Attendance System Booting ===")

show_centered("System Booting", 0)
show_centered("", 1)

print(f"Attempting to connect to: {config.WIFI_SSID}")
show_centered("Connecting...", 0)
if wifi.connect(config.WIFI_SSID, config.WIFI_PASSWORD):
    show_centered("WiFi Connected!", 0)
    print("Attempting to sync atomic time...")
    if not sync_clock():
        print("❌ Could not sync time. Will keep trying in the background.")
else:
    print("⚠️ No WiFi. Will keep trying in the background.")
time.sleep(1)

current_date = None

print("Starting background thread...")
_thread.start_new_thread(worker, ())

# ==========================================
# 2. THE INFINITE RUNTIME LOOP
# ==========================================
display.show_ready()
print("=== System Ready. Waiting for scans... ===")

last_activity_ms = time.ticks_ms()
last_clock_update_ms = time.ticks_ms()
last_scan_ms = {}
clock_message_shown = False
STANDBY_DELAY = 15000

while True:

    # Never record a scan with a wrong date
    if not clock_is_set():
        if not clock_message_shown:
            show_centered("Syncing clock", 0)
            show_centered("Please wait", 1)
            clock_message_shown = True
        time.sleep(1)
        continue
    if clock_message_shown:
        clock_message_shown = False
        display.show_ready()

    # -- Midnight Rollover Check --
    _, today_date, _ = get_datetime()
    if today_date != current_date:
        if EMP_STATUS.get("_date") != today_date:
            print(f"🌙 New day! Wiping states for {today_date}.")
            EMP_STATUS.clear()
            EMP_STATUS["_date"] = today_date
            save_status()
        current_date = today_date

    if pending_command is not None:
        command = pending_command
        run_command(command)
        pending_command = None
        last_activity_ms = time.ticks_ms()
        continue

    result = scan_finger()
    now_ms = time.ticks_ms()

    if result is not None:
        last_activity_ms = time.ticks_ms()
        lcd_time, safe_date, safe_time = get_datetime()
        emp_name = USERS.get(str(result)) if result > 0 else None

        if emp_name is None:
            print("❌ ACCESS DENIED - Unknown Finger")
            show_centered("UNKNOWN!!", 0)
            show_centered("", 1)
            alerts.error_beep()
            alerts.flash_error()

        elif result in last_scan_ms and time.ticks_diff(now_ms, last_scan_ms[result]) < DOUBLE_SCAN_MS:
            print(f"⏭️ Ignored double scan: {emp_name}")
            show_centered(emp_name, 0)
            show_centered("Already scanned", 1)
            alerts.success_beep()
            time.sleep_ms(RESULT_DISPLAY_MS)

        else:
            last_scan_ms[result] = now_ms

            # Determine IN or OUT based on status
            new_status = "OUT" if EMP_STATUS.get(emp_name) == "IN" else "IN"
            EMP_STATUS[emp_name] = new_status
            save_status()

            print(f"✅ ACCESS GRANTED! {emp_name} -> {new_status}")
            display.show_log(emp_name, lcd_time, new_status)
            alerts.success_beep()

            if new_status == "IN" and alerts.green_led:
                alerts.green_led.value(1)
            elif new_status == "OUT" and alerts.red_led:
                alerts.red_led.value(1)

            backup_log(result, time.time() + EPOCH_OFFSET)

            time.sleep_ms(RESULT_DISPLAY_MS)

            if alerts.green_led: alerts.green_led.value(0)
            if alerts.red_led: alerts.red_led.value(0)

            gc.collect()

        display.show_ready()
        print("\nWaiting for next scan...")

    else:
        if time.ticks_diff(now_ms, last_activity_ms) > STANDBY_DELAY:
            if time.ticks_diff(now_ms, last_clock_update_ms) > 1000:
                lcd_time, safe_date, _ = get_datetime()
                show_centered(lcd_time, 0)
                show_centered(safe_date, 1)
                last_clock_update_ms = now_ms

    time.sleep(0.02)
