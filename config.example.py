# Copy this file to config.py and fill in your own values.
# config.py is not stored in Git because it contains passwords.

# -----------------------------
# WiFi
# -----------------------------
WIFI_SSID = "YOUR_WIFI_NAME"
WIFI_PASSWORD = "YOUR_WIFI_PASSWORD"

# Google Apps Script URL
GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec"

# -----------------------------
# LCD
# -----------------------------
LCD_ADDRESS = 0x27
LCD_ROWS = 2
LCD_COLS = 16

# -----------------------------
# Fingerprint
# -----------------------------
# TEST: reverted to GPIO16/17 to verify behavior on this board
FINGER_RX = 16
FINGER_TX = 17
FINGER_BAUD = 57600

# -----------------------------
# LEDs
# -----------------------------
GREEN_LED = 18
RED_LED = 19

# -----------------------------
# Buzzer
# -----------------------------
BUZZER = 23

# -----------------------------
# Service Switch
# -----------------------------
SERVICE_SWITCH = 4

# -----------------------------
# Files
# -----------------------------
USERS_FILE = "users.json"
BACKUP_FILE = "attendance_backup.jsonl"

# -----------------------------
# Machine
# -----------------------------
DEVICE_NAME = "AttendanceMachine"
