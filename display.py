from machine import SoftI2C, Pin
from machine_i2c_lcd import I2cLcd

# NOTE: pins below match your latest debug test (SDA=25, SCL=26).
# Once you've confirmed which SDA/SCL pins actually work on your board,
# make sure these match the physical wiring.
i2c = SoftI2C(sda=Pin(25), scl=Pin(26), freq=100000)

try:
    # 0x27 is the standard address. If your screen is blank, try changing it to 0x3F.
    lcd = I2cLcd(i2c, 0x27, 2, 16)
except OSError:
    print("Warning: LCD not found at 0x27.")
    lcd = None

def show_centered(text, row=0):
    """Automatically centers text and erases old characters to prevent flickering."""
    if not lcd:
        return
    text = str(text)[:16]
    padding = (16 - len(text)) // 2
    clean_line = (" " * padding) + text + (" " * (16 - len(text) - padding))
    lcd.move_to(0, row)
    lcd.putstr(clean_line)

def show_ready():
    if lcd:
        show_centered("System Ready", 0)
        show_centered("Scan Finger...", 1)

def show_log(name, time_str, status_msg):
    """Line 1: Centered Name. Line 2: Status on left, Time on right."""
    if lcd:
        show_centered(name, 0)

        safe_status = str(status_msg)[:8]
        safe_time = str(time_str)[:8]

        middle_spaces = 16 - len(safe_status) - len(safe_time)
        if middle_spaces < 0:
            middle_spaces = 0

        line2 = safe_status + (" " * middle_spaces) + safe_time

        lcd.move_to(0, 1)
        lcd.putstr(line2)