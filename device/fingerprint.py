from machine import UART, Pin
import time

# Initialize UART
uart = UART(2, baudrate=57600, tx=Pin(17), rx=Pin(16))

# Standard R307S Hex Commands
CMD_GET_IMAGE = b'\xef\x01\xff\xff\xff\xff\x01\x00\x03\x01\x00\x05'
CMD_IMAGE2TZ  = b'\xef\x01\xff\xff\xff\xff\x01\x00\x04\x02\x01\x00\x08'
CMD_SEARCH    = b'\xef\x01\xff\xff\xff\xff\x01\x00\x08\x04\x01\x00\x00\xff\xff\x02\x0c'

def read_packet(timeout=1000):
    """Wait for and read the incoming UART packet from the sensor.

    NOTE: the settle delay after data first arrives was trimmed from 50ms
    to 15ms. A full R307S response packet is small (well under 20 bytes),
    which at 57600 baud takes only a few ms to fully arrive — 50ms was
    generous headroom, not a hardware requirement. If you ever see
    truncated/garbled packets on your specific sensor, bump this back up.
    """
    start = time.ticks_ms()
    while time.ticks_diff(time.ticks_ms(), start) < timeout:
        if uart.any():
            time.sleep_ms(15)
            return uart.read()
    return None

def scan_finger():
    """
    Executes the scan protocol.
    Returns:
      None : No finger detected or scan failed
      -1   : Finger detected, but NOT in database (Access Denied)
      int  : The matched Finger ID (Access Granted)
    """
    # STEP 1: Take the photo
    uart.write(CMD_GET_IMAGE)
    res = read_packet()
    if not res or len(res) < 12 or res[9] != 0x00:
        return None

    # STEP 2: Convert photo to a template (Buffer 1)
    uart.write(CMD_IMAGE2TZ)
    res = read_packet()
    if not res or len(res) < 12 or res[9] != 0x00:
        return None

    # STEP 3: Search the sensor's database
    uart.write(CMD_SEARCH)
    res = read_packet()

    if not res or len(res) < 16:
        return None

    # Byte 9 == 0x09 means NOT FOUND. Byte 9 == 0x00 means FOUND.
    if res[9] == 0x09:
        return -1
    elif res[9] == 0x00:
        finger_id = (res[10] << 8) | res[11]
        return finger_id

    return None