from fingerprint import uart, read_packet

def get_delete_command(finger_id):
    """Dynamically builds the DeletChar command packet for a specific ID."""
    id_high = (finger_id >> 8) & 0xFF
    id_low = finger_id & 0xFF

    # Instruction 0x0C deletes a template.
    # Checksum = Packet ID (0x01) + Length (0x07) + Instruction (0x0C) + ID_High + ID_Low + N_High (0x00) + N_Low (0x01)
    # 1 + 7 + 12 + 0 + 1 = 21
    checksum = 21 + id_high + id_low
    chk_high = (checksum >> 8) & 0xFF
    chk_low = checksum & 0xFF

    return bytes([0xef, 0x01, 0xff, 0xff, 0xff, 0xff, 0x01, 0x00, 0x07, 0x0c, id_high, id_low, 0x00, 0x01, chk_high, chk_low])

def delete_finger(finger_id):
    print(f"\nAttempting to erase ID: {finger_id}...")
    uart.write(get_delete_command(finger_id))
    res = read_packet(500)

    # Byte 9 == 0x00 means successful deletion
    if res and len(res) >= 12 and res[9] == 0x00:
        print(f"✅ SUCCESS! ID {finger_id} has been permanently deleted.")
        return True
    print(f"❌ Error: Could not delete ID {finger_id}. (It might already be empty).")
    return False

# --- MAIN LOOP (only when run directly from Thonny) ---
if __name__ == "__main__":
    print("=== ESP32 Fingerprint ERASER ===")
    print("Warning: Deleted IDs cannot be recovered!")
    while True:
        try:
            user_input = input("\nEnter the ID number to DELETE (or type 'q' to quit): ")

            if user_input.lower() == 'q':
                print("Exiting Eraser Tool.")
                break

            del_id = int(user_input)

            if del_id < 1 or del_id > 200:
                print("Please enter a valid ID between 1 and 200.")
                continue

            delete_finger(del_id)

        except ValueError:
            print("Invalid input. Please enter a number.")
