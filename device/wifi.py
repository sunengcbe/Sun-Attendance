import network
import time

def connect(ssid, password):
    """Attempts to connect to WiFi with a 10-second timeout."""
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    
    if not wlan.isconnected():
        print(f"Connecting to WiFi: {ssid}...")
        wlan.connect(ssid, password)
        
        timeout = 10
        while not wlan.isconnected() and timeout > 0:
            time.sleep(1)
            timeout -= 1
            print(".", end="")
            
    if wlan.isconnected():
        print("\nWiFi Connected!")
        print("IP Address:", wlan.ifconfig()[0])
        return True
    else:
        print("\nWiFi Connection Failed.")
        return False