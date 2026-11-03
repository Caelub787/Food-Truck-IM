# Using Food Truck IM

A short guide for admins, managers, and drivers. Want to click around first? Build the demo (`npm run build:demo`) or open the demo link you were sent.

## For the admin: first day

1. **Business settings**: check your time zone, turn features on or off (scheduling, manager count checks, expiration tracking, loading checklist), pick who enters drink counts, and set the limits for flags.
2. **Setup**: add your locations and trucks, then supplies (or use a starter kit, or import a spreadsheet). For each supply, set the units you count in and buy in, the cost, a reorder level and an "order up to" amount, and the supplier. Add a picture too if you like (take one or pick one from your phone). It shows next to the supply on lists, counts, and the loading list, so drivers know exactly what to grab.
3. **Products**: add what you sell, its sizes and prices, and a recipe for each size (what one drink uses). Add ons like oat milk can add or swap a supply.
4. **Par levels** (Setup): how much each truck should leave with. Loading lists fill in from these. After a few weeks the app suggests better ones.
5. **People**: invite managers and drivers by email. They get a link to set a password.
6. **My account**: pick which emails and notifications you want, and turn on notifications for your phone.
7. **Client bookings** (optional, Business settings): turn on your booking page, pick its name, the days and hours you take bookings, how much notice you need, and how many events can happen at once. Share the link it gives you.
8. **Budget**: set a budget for each category, type in your account balances, and decide in Business settings whether managers can see it.

## For drivers: a shift

1. **Start**: tap **Start a shift** (or **Start shift** on a planned one in the Schedule). Pick the truck, the Lead, and who else is working. If someone already started your truck, tap **Join**.
2. **Starting count**: each line shows what the app thinks is on the truck. Only change what's different. The Lead taps **Confirm starting count**.
3. **Load**: amounts are filled in to get back to the par levels. Change anything you load differently, then **Load these**. Tick off the loading checklist.
   * On a booked event, the shift shows the address (tap to open maps), the on site contact (tap to call), notes, and what to bring. The loading list fills in to what the event needs.
4. **During the shift**: log waste (a supply, or whole drinks) with a reason and a photo if it helps. If your business has drivers count drinks, use **Sales**: tap + for each drink, and add drinks with add ons or free drinks (drop replacements, giveaways, employee drinks) with the button below.
5. **Ending count**: count everything left before anything goes back to the warehouse. Everyone can help. The Lead confirms.
6. **Finish**: send back anything that shouldn't stay on the truck, then the Lead taps **Finish shift**. The app works out what was used.

No signal? Keep going. Counts, loads, and waste are saved on the phone and sent when signal comes back. A yellow bar shows what's waiting.

## For managers: every day

* **Home** shows what needs a look, count checks waiting, what's planned today, and trucks out now.
* **Needs a look**: things the app noticed (usage that doesn't match sales, starting counts that didn't match, low stock, things expiring, shifts left open). Mark them looked at, with a note.
* **Count checks** (if turned on): after a shift, count the checked supplies (like cups) on the truck before it goes out again. You won't see the driver's numbers until yours are saved.
* **Inventory**: stock everywhere, live. Receive deliveries, count, move stock, log warehouse waste, and see every move in History.
* **Orders**: order lists are made every morning when things run low. Check them and approve. Email suppliers get the order right away.
* **Sales**: upload a sales file from your register (Square and most others work). Match item names once. Uploading the same file again never counts anything twice, and any upload can be undone.
* **Schedule** (if turned on): plan who works which truck and when. Repeat weekly. Booked events show here with their details.
* **Bookings** (if turned on): requests from your booking page show up here and on Home, live. Open one to see who's asking and what they need. **Accept** to pick the truck, Lead and crew, the manager in charge, the on site contact, what to bring, the price, and notes. Everyone on it gets an email and a notification with the details, and the client gets a confirmation. **Decline** sends the client a polite email with your message. Booked events can be changed or cancelled later.
* **Budget** (admins, and managers if allowed): money on hand from the balances you type in, and each category's budget next to what really came in or went out. Inventory fills in from deliveries, sales from sales, and events from booking prices. Use **Add spending** for the rest. Switch to **Whole year** for one big sheet, and download it as a CSV.
* **Reports**: usage vs sales, waste, free drinks, drivers, count checks, and sales minus costs, with CSV downloads.
* **Fixing a finished shift**: open it, go to **Results**, and tap **Fix** on a supply. Say why. The change and the reason are kept in the history.

## What happens on its own

* Low stock alerts, reminders for shifts that didn't start or were left open, and expiration warnings.
* A morning email (what's low, expiring, or waiting), a daily report, and weekly and monthly summaries.
* Order lists each morning, par level suggestions each week, and flags for patterns (like a supply that keeps coming up short on one truck).
