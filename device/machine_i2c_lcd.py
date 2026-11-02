import time
from lcd_api import LcdApi

class I2cLcd(LcdApi):
    def __init__(self, i2c, i2c_addr, num_lines, num_columns):
        self.i2c = i2c
        self.i2c_addr = i2c_addr
        self.i2c.writeto(self.i2c_addr, bytearray([0]))
        time.sleep_ms(20)
        self.hal_write_init_nibble(0x30)
        time.sleep_ms(5)
        self.hal_write_init_nibble(0x30)
        time.sleep_ms(1)
        self.hal_write_init_nibble(0x30)
        self.hal_write_init_nibble(0x20)
        super().__init__(num_lines, num_columns)
        cmd = 0x20
        if num_lines > 1:
            cmd |= 0x08
        self.hal_write_command(cmd)
        self.hal_write_command(0x0C)
        self.hal_write_command(0x06)
        self.clear()

    def hal_write_init_nibble(self, nibble):
        byte = (nibble & 0xF0) | 0x04
        self.i2c.writeto(self.i2c_addr, bytearray([byte]))
        time.sleep_ms(1)
        byte &= 0xFB
        self.i2c.writeto(self.i2c_addr, bytearray([byte]))
        time.sleep_ms(1)

    def hal_write_command(self, cmd):
        byte = (cmd & 0xF0) | 0x04
        if self.backlight:
            byte |= 0x08
        self.i2c.writeto(self.i2c_addr, bytearray([byte]))
        byte &= 0xFB
        self.i2c.writeto(self.i2c_addr, bytearray([byte]))
        byte = ((cmd << 4) & 0xF0) | 0x04
        if self.backlight:
            byte |= 0x08
        self.i2c.writeto(self.i2c_addr, bytearray([byte]))
        byte &= 0xFB
        self.i2c.writeto(self.i2c_addr, bytearray([byte]))
        if cmd <= 2:
            time.sleep_ms(5)

    def hal_write_data(self, data):
        byte = (data & 0xF0) | 0x05
        if self.backlight:
            byte |= 0x08
        self.i2c.writeto(self.i2c_addr, bytearray([byte]))
        byte &= 0xFB
        self.i2c.writeto(self.i2c_addr, bytearray([byte]))
        byte = ((data << 4) & 0xF0) | 0x05
        if self.backlight:
            byte |= 0x08
        self.i2c.writeto(self.i2c_addr, bytearray([byte]))
        byte &= 0xFB
        self.i2c.writeto(self.i2c_addr, bytearray([byte]))

    def hal_backlight_on(self):
        self.i2c.writeto(self.i2c_addr, bytearray([0x08]))

    def hal_backlight_off(self):
        self.i2c.writeto(self.i2c_addr, bytearray([0x00]))