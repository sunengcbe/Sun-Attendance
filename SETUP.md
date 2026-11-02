# Setup

Do these steps in order. Button names on the Supabase and GitHub sites may differ slightly.

## 1. Create the database
1. Go to https://supabase.com, sign up, and create a new project on the Free plan. Pick an India or nearby region if offered. Save the database password somewhere safe.
2. Open **SQL Editor**, paste all of `supabase/schema.sql`, and press **Run**.
3. Start a new query, paste all of `private/setup_private.sql`, and press **Run**. This file adds your staff and is on your PC only.

## 2. Create your login
1. Open **Authentication > Users > Add user > Create new user**. Enter your email and a strong password, and tick auto-confirm.
2. Open the Authentication sign-in settings and turn **off** "Allow new users to sign up". Only you can log in after this.

## 3. Connect the app
1. Open **Project Settings > API** (or **API Keys**). Copy the **Project URL** and the **publishable** or **anon public** key. Never use the `service_role` or `secret` key.
2. Put both in `docs/js/config.js`.
3. Put the same two values in `device/config.py` as `SUPABASE_URL` and `SUPABASE_KEY`. `DEVICE_SECRET` is already filled in, so leave it as it is.

## 4. Publish the app
1. Check what will be pushed. `device/config.py` and anything in `private/` must not be listed:

```bash
git add .
```

```bash
git status
```

2. Commit and push:

```bash
git commit -m "Add attendance web app"
```

```bash
git push
```

3. On GitHub, open **Settings > Pages**. Under **Build and deployment**, choose **Deploy from a branch**, then branch `main`, folder `/docs`, and **Save**.
4. After a minute or two, open https://sunengcbe.github.io/Sun-Attendance/ on your phone and sign in.
5. To install it, open the browser menu and choose **Add to Home screen**.

## 5. Upload to the ESP32 with Thonny
1. Connect the ESP32 by USB. In Thonny, press **Stop**.
2. **Before uploading**, check the ESP32 pane for `attendance_backup.jsonl`. If it's there, it holds scans that never reached the Google Sheet, so download a copy with **Download to**. The new code can't send those old records.
3. In the "This computer" pane, open the `device` folder of this project.
4. Select these files, right-click, and choose **Upload to /**:
   `alerts.py`, `cloud.py`, `config.py`, `delete.py`, `display.py`, `enroll.py`, `fingerprint.py`, `lcd_api.py`, `machine_i2c_lcd.py`, `main.py`, `wifi.py`
5. Press **Ctrl+D** in the Thonny shell to restart. You should see "System Ready. Waiting for scans...". Your local status and staff data are kept in `private/`, so this upload can't overwrite what is on the ESP32.

## 6. Test on the real machine
- [ ] Settings in the app shows **Machine online** within about 30 seconds.
- [ ] A scan appears on the Today page. It refreshes every 30 seconds, or you can reload the page.
- [ ] The LCD shows the name, IN/OUT and time, and nothing about being late or early.
- [ ] A second scan within 2 minutes shows "Already scanned" and adds nothing.
- [ ] Register a test person from your phone on mobile data, following the LCD.
- [ ] Unplug the router, scan twice, and plug it back in. Both scans appear with no duplicates.
- [ ] Restart the ESP32 with the router off. The LCD shows "Syncing clock" and scanning waits until the router is back.
- [ ] Delete the test person, restore them from Settings, and confirm they can scan again. Then delete them again.
- [ ] Leave it running for a full working day. Look for slow scans or restarts in the Thonny shell.

If something goes wrong, send the text from the Thonny shell.

## Good to know
- **Free plan limits:** 500 MB of database, 5 GB of data transfer a month, and no automatic backups.
- **Pausing:** free projects pause after 1 week of inactivity. If the machine is off that long, open the Supabase dashboard and press **Restore**.
- **The 30-day clear:** it runs even if you haven't downloaded. The app reminds you for a week beforehand.
- **Try without a database:** add `?demo=1` to the app's address to see made-up data.
