import json
import gc
import _thread
import urequests
import config

# Create a lock to prevent two HTTPS requests from crashing the ESP32's memory
sync_lock = _thread.allocate_lock()

def _rpc(name, payload):
    """Calls one of the machine functions in supabase/schema.sql."""
    payload["p_secret"] = config.DEVICE_SECRET
    url = config.SUPABASE_URL.strip() + "/rest/v1/rpc/" + name
    headers = {
        "apikey": config.SUPABASE_KEY,
        "Content-Type": "application/json",
    }

    with sync_lock:
        gc.collect()
        res = None
        try:
            res = urequests.post(url, data=json.dumps(payload), headers=headers)
            code = res.status_code
            text = res.text
        finally:
            if res is not None:
                res.close()

    if code >= 300:
        raise OSError("HTTP {}: {}".format(code, text[:80]))
    return json.loads(text) if text else None

def send_scan(finger_id, epoch):
    return _rpc("device_scan", {"p_finger_id": finger_id, "p_epoch": epoch})

def poll():
    return _rpc("device_poll", {})

def get_staff():
    return _rpc("device_staff", {})

def update_command(command_id, status, step=None, message=None):
    _rpc("device_command_update", {
        "p_id": command_id, "p_status": status, "p_step": step, "p_message": message,
    })
