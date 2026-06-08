# Hotell Vänersborg – Personalportal
## Setup-guide (steg för steg)

---

## 1. Supabase – databas & inloggning

1. Gå till **supabase.com** och skapa ett gratis konto
2. Klicka **New Project** → välj namn "hotel-vanersborg" och ett lösenord
3. Vänta ~2 min tills projektet startat
4. Gå till **SQL Editor** (vänster meny) → klistra in hela innehållet från `supabase-schema.sql` → klicka **Run**
   - Det skapar tabellerna `rooms`, `bookings`, `housekeeping` och fyller i rum 9–20
5. Gå till **Authentication → Users** → klicka **Add user**
   - Skapa ditt admin-konto: t.ex. `sigge@hotellvanersborg.se` + lösenord
   - Skapa ett personal-konto: t.ex. `personal@hotellvanersborg.se` + lösenord
6. Gå till **Project Settings → API** och kopiera:
   - **Project URL** (ser ut som `https://abcdef.supabase.co`)
   - **anon public** key

---

## 2. GitHub – ladda upp koden

1. Gå till **github.com** → skapa nytt repo "hotel-vanersborg" (privat)
2. Ladda upp alla filer från den här mappen
   - Enklast: dra och släpp filerna i GitHub-webbgränssnittet
   - Eller använd git:
     ```bash
     git init
     git add .
     git commit -m "Initial commit"
     git remote add origin https://github.com/DITT_ANVÄNDARNAMN/hotel-vanersborg
     git push -u origin main
     ```

---

## 3. Vercel – deploy på nätet

1. Gå till **vercel.com** → logga in med GitHub
2. Klicka **Add New → Project** → välj ditt GitHub-repo
3. Under **Environment Variables**, lägg till:
   ```
   REACT_APP_SUPABASE_URL      = https://ditt_projekt_id.supabase.co
   REACT_APP_SUPABASE_ANON_KEY = din_anon_key
   REACT_APP_ADMIN_EMAIL       = sigge@hotellvanersborg.se
   ```
4. Klicka **Deploy** – efter ~2 min är siten live!
5. Vercel ger en URL som `https://hotel-vanersborg.vercel.app`
   - Du kan koppla en egen domän under **Settings → Domains**

---

## 4. Daglig användning

### Du (admin):
1. Gå till siten → logga in med admin-kontot
2. Klicka **Importera XLS** → ladda upp Booking.com-exporten
3. Bokningarna importeras. Gå till **Bokningar** och tilldela varje bokning ett specifikt rum via dropdownen
   - Appen föreslår rum automatiskt baserat på Booking.com-kategorin (t.ex. "Balkongrum (18 & 19)" föreslår rum 18 och 19)

### Personal:
1. Logga in med personal-kontot
2. Ser bara **Idag**-vyn och **Kalender**-vyn
3. Trycker på **"Markera städat"** när ett rum är klart

---

## 5. Exportera från Booking.com

1. Logga in på **extranet.booking.com**
2. Gå till **Reservationer**
3. Välj datumintervall (t.ex. kommande 1–2 veckor)
4. Klicka **Exportera** → välj **Excel (.xls)**
5. Ladda upp den filen i portalen

---

## Rumsnummer

Rum-ID:n i databasen matchar siffrorna i Booking.com-kategorierna:

| Rum-ID | Namn     | Typ                    |
|--------|----------|------------------------|
| 9      | Rum 9    | Familjesviten          |
| 10     | Rum 10   | Budgetrum              |
| 11–14  | Rum 11–14| French Balcony Room    |
| 15     | Rum 15   | Budgetrum              |
| 16     | Rum 16   | Familjesviten          |
| 17     | Rum 17   | Studio med kök         |
| 18–19  | Rum 18–19| Balkongrum             |
| 20     | Rum 20   | Premiumrum             |

*Justera om det faktiska antalet rum är annorlunda – ändra i `supabase-schema.sql` och kör om.*
