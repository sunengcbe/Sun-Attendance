from machine import Pin
import time

# ==========================================
# HARDWARE PINS
# ==========================================
BUZZER_PIN = 23
GREEN_LED_PIN = 18 
RED_LED_PIN = 19    

try:
    buzzer = Pin(BUZZER_PIN, Pin.OUT)
    buzzer.value(0)
    
    green_led = Pin(GREEN_LED_PIN, Pin.OUT)
    green_led.value(0)
    
    red_led = Pin(RED_LED_PIN, Pin.OUT)
    red_led.value(0)
except Exception as e:
    print("Alert hardware setup failed:", e)
    buzzer, green_led, red_led = None, None, None

# --- AUDIO ALERTS ---
def success_beep():
    if buzzer:
        buzzer.value(1)
        time.sleep(0.1)
        buzzer.value(0)
        time.sleep(0.1)
        buzzer.value(1)
        time.sleep(0.1)
        buzzer.value(0)

def error_beep():
    if buzzer:
        buzzer.value(1)
        time.sleep(0.6)
        buzzer.value(0)

# --- VISUAL LED ALERTS ---
def flash_in():
    """Solid Green Light for 2 seconds"""
    if green_led:
        green_led.value(1)
        time.sleep(2)
        green_led.value(0)
    else:
        time.sleep(2) # Fallback pause if LED fails

def flash_out():
    """Solid Red Light for 2 seconds"""
    if red_led:
        red_led.value(1)
        time.sleep(2)
        red_led.value(0)
    else:
        time.sleep(2)

def flash_error():
    """3 rapid flashes of the Red LED"""
    if red_led:
        for _ in range(3):
            red_led.value(1)
            time.sleep(0.15)
            red_led.value(0)
            time.sleep(0.15)