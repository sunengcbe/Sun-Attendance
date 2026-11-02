from machine import UART, Pin
import time

# Initialize UART
uart = UART(2, baudrate=57600, tx=Pin(17), rx=Pin(16))

# Standard R307S Hex Commands for Enrollment
CMD_GET_IMAGE  = b'\xef\x01\xff\xff\xff\xff\x01\x00\x03\x01\x00\x05'
CMD_IMAGE2TZ_1 = b'\xef\x01\xff\xff\xff\xff\x01\x00\x04\x02\x01\x00\x08'
CMD_IMAGE2TZ_2 = b'\xef\x01\xff\xff\xff\xff\x01\x00\x04\x02\x02\x00\x09'
CMD_REG_MODEL  = b'\xef\x01\xff\xff\xff\xff\x01\x00\x03\x05\x00\x09'

def read_packet(timeout=1000):
    """Wait for and read the incoming UART packet from the sensor."""
    start = time.ticks_ms()
    while time.ticks_diff(time.ticks_ms(), start) < timeout:
        if uart.any():
            time.sleep_ms(50) 
            return uart.read()
    return None

def get_store_command(finger_id):
    """Dynamically builds the STORE command packet with correct checksums for a specific ID."""
    id_high = (finger_id >> 8) & 0xFF
    id_low = finger_id & 0xFF
    
    # Checksum = Packet ID (0x01) + Length (0x06) + Instruction (0x06) + Buffer (0x01) + ID_High + ID_Low
    checksum = 14 + id_high + id_low
    chk_high = (checksum >> 8) & 0xFF
    chk_low = checksum & 0xFF
    
    return bytes([0xef, 0x01, 0xff, 0xff, 0xff, 0xff, 0x01, 0x00, 0x06, 0x06, 0x01, id_high, id_low, chk_high, chk_low])

def wait_for_finger():
    """Loops until the sensor successfully captures an image."""
    while True:
        uart.write(CMD_GET_IMAGE)
        res = read_packet(500)
        # Byte 9 == 0x00 means image successfully taken
        if res and len(res) >= 12 and res[9] == 0x00:
            return True
        time.sleep(0.1)

def enroll_finger(finger_id):
    """Executes the full 2-tap enrollment process."""
    print(f"\n--- ENROLLING NEW EMPLOYEE AS ID: {finger_id} ---")
    
    # STEP 1: First scan
    print("Place finger on sensor...")
    wait_for_finger()
    uart.write(CMD_IMAGE2TZ_1)
    res = read_packet()
    if not res or len(res) < 12 or res[9] != 0x00:
        print("Error: Could not process the first scan.")
        return False
        
    # STEP 2: Wait for removal
    print("Lift finger...")
    time.sleep(2.5) 
    
    # STEP 3: Second scan
    print("Place the SAME finger again...")
    wait_for_finger()
    uart.write(CMD_IMAGE2TZ_2)
    res = read_packet()
    if not res or len(res) < 12 or res[9] != 0x00:
        print("Error: Could not process the second scan.")
        return False
        
    # STEP 4: Merge the two scans into a template
    uart.write(CMD_REG_MODEL)
    res = read_packet()
    if not res or len(res) < 12 or res[9] != 0x00:
        print("Error: Scans did not match! The user moved their finger. Try again.")
        return False
        
    # STEP 5: Store the template in flash memory
    uart.write(get_store_command(finger_id))
    res = read_packet()
    if not res or len(res) < 12 or res[9] != 0x00:
        print(f"Error: Could not save template to ID {finger_id}.")
        return False
        
    print(f"SUCCESS! Employee finger saved to hardware slot {finger_id}.")
    return True

# --- MAIN LOOP ---
print("ESP32 Fingerprint Enrollment System")
print("Warning: Do not use ID 1, as you are already enrolled there!")

while True:
    try:
        # Ask you to type an ID into the MicroPython console
        user_input = input("\nEnter a new Employee ID number to enroll (or type 'q' to quit): ")
        
        if user_input.lower() == 'q':
            break
            
        new_id = int(user_input)
        
        if new_id < 1 or new_id > 200:
            print("Please enter a valid ID between 1 and 200.")
            continue
            
        enroll_finger(new_id)
        
    except ValueError:
        print("Invalid input. Please enter a number.")