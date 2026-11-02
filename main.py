import time
import json
import ntptime
import gc
import network
import urequests
import _thread
import config
import wifi
import display
import alerts
from fingerprint import scan_finger

# Set up the network interface to monitor the connection
wlan = network.WLAN(network.STA_IF)

# Create a lock to prevent two HTTPS requests from crashing the ESP32's memory
sync_lock = _thread.allocate_lock()

LCD_WIDTH = 16
RESULT_DISPLAY_MS = 700

# --- HELPER FUNCTIONS ---
def show_centered(text, row=0):
    if not display.lcd:
        return
    text = str(text)[:LCD_WIDTH]
    padding = (LCD_WIDTH - len(text)) // 2
    clean_line = (" " * padding) + text + (" " * (LCD_WIDTH - len(text) - padding))
    display.lcd.move_to(0, row)
    display.lcd.putstr(clean_line)

def load_users():
    try:
        with open("employee.json", "r") as f:
            return json.load(f)
    except Exception as e:
        print("⚠️ Could not load employee.json:", e)
        return {}

USERS = load_users()

def get_user_name(finger_id):
    return USERS.get(str(finger_id), f"ID {finger_id}")

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
def backup_log(name, date_str, time_str, status):
    try:
        with open(config.BACKUP_FILE, "a") as f:
            f.write(json.dumps({"name": name, "date": date_str, "time": time_str, "status": status}) + "\n")
        print(f"📝 Backed up locally: {name} @ {time_str} ({status})")
    except Exception as e:
        print("❌ Backup write failed:", e)

def send_to_sheet(name, date_str, time_str, status):
    safe_name = name.strip().replace(" ", "%20")
    safe_date_url = date_str.replace(" ", "%20")
    safe_time_url = time_str.replace(" ", "%20")
    base_url = config.GOOGLE_SCRIPT_URL.strip()

    sync_url = f"{base_url}?name={safe_name}&date={safe_date_url}&time={safe_time_url}&status={status}"
    headers = {"User-Agent": "Mozilla/5.0", "Accept": "*/*"}
    
    with sync_lock:
        res = None
        try:
            res = urequests.get(sync_url, headers=headers)
            status_resp = res.text
            return status_resp
        finally:
            if res is not None:
                res.close()

def flush_backup():
    try:
        with open(config.BACKUP_FILE, "r") as f:
            lines = f.readlines()
    except OSError:
        return  

    if not lines:
        return

    print(f"🔄 Flushing {len(lines)} backed-up record(s) to cloud...")
    remaining = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
            send_to_sheet(rec["name"], rec["date"], rec["time"], rec.get("status", "IN"))
            time.sleep(0.5) 
            gc.collect()
        except Exception as e:
            print("  Could not flush one record, keeping it:", e)
            remaining.append(line)

    try:
        if remaining:
            with open(config.BACKUP_FILE, "w") as f:
                for line in remaining:
                    f.write(line + "\n")
            print(f"⚠️ {len(remaining)} record(s) still pending.")
        else:
            import os
            os.remove(config.BACKUP_FILE)
            print("✅ Backup flush complete, all records synced.")
    except Exception as e:
        print("Backup cleanup failed:", e)

def sync_in_background(emp_name, safe_date, safe_time, status):
    try:
        send_to_sheet(emp_name, safe_date, safe_time, status)
        print(f"✅ Cloud Sync Success: {emp_name} logged as {status}")
    except Exception as e:
        print("❌ Cloud Sync Failed! Saving locally instead. Reason:", e)
        backup_log(emp_name, safe_date, safe_time, status)

# ==========================================
# 1. SYSTEM INITIALIZATION & NTP SYNC
# ==========================================
print("=== ESP32 Attendance System Booting ===")

show_centered("System Booting", 0)
show_centered("", 1)

print(f"Attempting to connect to: {config.WIFI_SSID}")
wifi.connect(config.WIFI_SSID, config.WIFI_PASSWORD)

while not wlan.isconnected():
    show_centered("Connecting...", 0)
    time.sleep(1)

show_centered("WiFi Connected!", 0)
show_centered("", 1)
time.sleep(1)

print("Attempting to sync atomic time...")
time_synced = False
ntp_servers = ["pool.ntp.org", "time.google.com", "time.windows.com"]

for server in ntp_servers:
    if time_synced:
        break
    ntptime.host = server
    print(f"Trying NTP server: {server}")
    for attempt in range(3):
        try:
            ntptime.settime()
            print("🕒 Internal System Clock synced to Internet Time!")
            time_synced = True
            break
        except Exception as e:
            print(f"  Attempt {attempt + 1} failed: {e}")
            time.sleep(1.5)

if not time_synced:
    print("❌ CRITICAL: Could not sync time. Check internet access.")

# -- NEW: Check if this is a new day immediately after getting time --
_, boot_date, _ = get_datetime()
if EMP_STATUS.get("_date") != boot_date:
    print("🌙 New day detected on boot! Resetting yesterday's IN/OUT states.")
    EMP_STATUS.clear()
    EMP_STATUS["_date"] = boot_date
    save_status()

current_date = boot_date

# Kick off the flush in the background
print("Spawning background thread to flush backups...")
try:
    _thread.start_new_thread(flush_backup, ())
except Exception as e:
    print("⚠️ Could not start flush thread:", e)

time.sleep(1)

# ==========================================
# 2. THE INFINITE RUNTIME LOOP
# ==========================================
display.show_ready()
print("=== System Ready. Waiting for scans... ===")

last_activity_ms = time.ticks_ms()
last_clock_update_ms = time.ticks_ms()
STANDBY_DELAY = 15000

while True:

    # -- NEW: Midnight Rollover Check --
    _, today_date, _ = get_datetime()
    if today_date != current_date:
        print(f"🌙 Midnight Rollover! Wiping states for {today_date}.")
        EMP_STATUS.clear()
        EMP_STATUS["_date"] = today_date
        save_status()
        current_date = today_date

    if not wlan.isconnected():
        print("⚠️ No Internet. Locking scanner for 1 minute.")
        show_centered("No Internet", 0)
        show_centered("Retrying in 1m..", 1)
        time.sleep(60)

        print("🔄 Attempting to reconnect...")
        show_centered("Reconnecting...", 0)
        show_centered("", 1)
        wifi.connect(config.WIFI_SSID, config.WIFI_PASSWORD)
        time.sleep(3)

        if wlan.isconnected():
            print("✅ Internet restored!")
            try:
                ntptime.host = "pool.ntp.org"
                ntptime.settime()
            except:
                pass
            
            try:
                _thread.start_new_thread(flush_backup, ())
            except:
                pass
                
            display.show_ready()
            last_activity_ms = time.ticks_ms()

        continue

    result = scan_finger()
    now_ms = time.ticks_ms()

    if result is not None:
        last_activity_ms = time.ticks_ms()
        lcd_time, safe_date, safe_time = get_datetime()

        if result == -1:
            print("❌ ACCESS DENIED - Unknown Finger")
            show_centered("UNKNOWN!!", 0)
            show_centered("", 1)
            alerts.error_beep()
            alerts.flash_error()

        elif result > 0:
            emp_name = get_user_name(result)

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

            try:
                _thread.start_new_thread(
                    sync_in_background, (emp_name, safe_date, safe_time, new_status)
                )
            except Exception as e:
                print("⚠️ Background thread busy, syncing inline instead:", e)
                sync_in_background(emp_name, safe_date, safe_time, new_status)

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