import time
from fingerprint import uart, read_packet

# Standard R307S Hex Commands for Enrollment
CMD_GET_IMAGE  = b'\xef\x01\xff\xff\xff\xff\x01\x00\x03\x01\x00\x05'
CMD_IMAGE2TZ_1 = b'\xef\x01\xff\xff\xff\xff\x01\x00\x04\x02\x01\x00\x08'
CMD_IMAGE2TZ_2 = b'\xef\x01\xff\xff\xff\xff\x01\x00\x04\x02\x02\x00\x09'
CMD_REG_MODEL  = b'\xef\x01\xff\xff\xff\xff\x01\x00\x03\x05\x00\x09'

FINGER_TIMEOUT_MS = 60000

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
    """Loops until the sensor captures an image. Returns False if nobody scans in time."""
    start = time.ticks_ms()
    while time.ticks_diff(time.ticks_ms(), start) < FINGER_TIMEOUT_MS:
        uart.write(CMD_GET_IMAGE)
        res = read_packet(500)
        # Byte 9 == 0x00 means image successfully taken
        if res and len(res) >= 12 and res[9] == 0x00:
            return True
        time.sleep(0.1)
    return False

def enroll_finger(finger_id, on_step=print):
    """Executes the full 2-tap enrollment process. Returns None on success, or the error message."""
    print(f"\n--- ENROLLING NEW EMPLOYEE AS ID: {finger_id} ---")

    # STEP 1: First scan
    on_step("place")
    if not wait_for_finger():
        return "Nobody placed a finger in time."
    uart.write(CMD_IMAGE2TZ_1)
    res = read_packet()
    if not res or len(res) < 12 or res[9] != 0x00:
        return "Could not process the first scan."

    # STEP 2: Wait for removal
    on_step("lift")
    time.sleep(2.5)

    # STEP 3: Second scan
    on_step("again")
    if not wait_for_finger():
        return "Nobody placed a finger in time."
    uart.write(CMD_IMAGE2TZ_2)
    res = read_packet()
    if not res or len(res) < 12 or res[9] != 0x00:
        return "Could not process the second scan."

    # STEP 4: Merge the two scans into a template
    on_step("saving")
    uart.write(CMD_REG_MODEL)
    res = read_packet()
    if not res or len(res) < 12 or res[9] != 0x00:
        return "Scans did not match. The finger moved, try again."

    # STEP 5: Store the template in flash memory
    uart.write(get_store_command(finger_id))
    res = read_packet()
    if not res or len(res) < 12 or res[9] != 0x00:
        return f"Could not save template to ID {finger_id}."

    print(f"SUCCESS! Employee finger saved to hardware slot {finger_id}.")
    return None

# --- MAIN LOOP (only when run directly from Thonny) ---
if __name__ == "__main__":
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

            error = enroll_finger(new_id)
            if error:
                print("Error:", error)

        except ValueError:
            print("Invalid input. Please enter a number.")
