# Gogo สำหรับลูกบ้าน

เว็บ Next.js และ TypeScript สำหรับเลือกติดตามรถ 3 คัน รับตำแหน่งจาก APK เดิมผ่าน HTTPS และ Supabase PostgreSQL Realtime

## เปิดเว็บในเครื่อง

ใช้ Node.js 22 ขึ้นไป จากโฟลเดอร์ `web` รันคำสั่งนี้

```sh
npm ci
npm run dev
```

เปิด http://localhost:3000 หากยังไม่ตั้งค่า Supabase เว็บจะแสดงว่ายังไม่ได้เชื่อมต่อ เปิด `/?demo=1` เพื่อทดลองหน้าจอด้วยตำแหน่งจำลองที่ติดป้ายชัดเจน โหมดนี้ไม่ได้ทดสอบการรับข้อมูลจากมือถือจริง

## เตรียม Supabase

1. สร้างโปรเจกต์ Supabase เลือก region ใกล้ผู้ใช้ เช่น Singapore
2. เปิด SQL Editor แล้วรัน SQL ใน `supabase/migrations/` ตามลำดับ
3. ตรวจว่า `vehicle_positions` อยู่ใน publication `supabase_realtime` และเปิด Realtime ของโปรเจกต์
4. นำ Project URL และ anon key จาก Supabase API settings ไปตั้งค่าด้านล่าง
5. เก็บ service role key ไว้เฉพาะเซิร์ฟเวอร์ ห้ามใส่ในตัวแปรที่ขึ้นต้น `NEXT_PUBLIC_`

SQL ให้ผู้ชมอ่านตำแหน่งล่าสุดได้โดยไม่ล็อกอิน ผู้ที่เข้าถึงเว็บหรือ project API ได้จึงอ่านพิกัดได้ ไม่เปิดเผยชื่อคนขับหรือ token รุ่นนี้ยังไม่มีการตรวจสิทธิ์ลูกบ้าน หากต้องการดูเฉพาะสมาชิกต้องเพิ่มระบบ login และเปลี่ยน RLS ก่อนเปิดใช้กับกลุ่มนั้น

## ตั้งค่าสภาพแวดล้อม

คัดลอก `.env.example` เป็น `.env.local` แล้วใส่ค่าให้ครบ

- `NEXT_PUBLIC_SUPABASE_URL` เป็น Project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` เป็น publishable key ที่อ่านข้อมูลตาม RLS ได้ หากใช้ anon key รุ่นเดิม ให้ตั้ง `NEXT_PUBLIC_SUPABASE_ANON_KEY` แทน โดยเว็บเลือก publishable key ก่อน
- `SUPABASE_SERVICE_ROLE_KEY` เป็นคีย์ฝั่งเซิร์ฟเวอร์เท่านั้น
- `DRIVER_TOKENS_JSON` เป็น JSON object ที่มีคีย์ `SHUTTLE-01`, `SHUTTLE-02`, `SHUTTLE-03` แต่ละค่าคือ token สุ่มที่ต่างกัน ความยาว 32–256 ตัว ใช้ตัวอักษร ตัวเลข `_` หรือ `-`

สร้าง token ด้วย password manager หรือคำสั่งนี้ รันแยกสำหรับรถแต่ละคันและเก็บค่าไว้เป็นความลับ

```sh
node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url")+"\n")'
```

ตั้งค่า env ทั้งบน Vercel และเครื่องพัฒนา ค่า public ถูกฝังตอน build ดังนั้นเปลี่ยนแล้วต้อง build หรือ deploy ใหม่ อย่าเผยแพร่ `.env.local`

## Deploy ด้วย Vercel

1. นำ source ขึ้น Git repository ของคุณ รวม `web/package-lock.json` และ SQL แต่ไม่รวม `.env.local`, `node_modules`, `.next`, `.tooling`
2. Import repository บน Vercel แล้วตั้ง **Root Directory** เป็น `web`
3. Framework preset ใช้ **Next.js** และ Node.js 22 ขึ้นไป ไฟล์ `vercel.json` กำหนด function region เป็น Singapore ไว้แล้ว
4. ตั้ง Environment Variables ทั้ง 4 ตัวสำหรับ environment ที่จะใช้งาน
5. Deploy แล้วเปิด URL ตรวจว่าเว็บเชื่อมต่อ Supabase ได้
6. เปิดแอปบนมือถือประจำรถแต่ละคัน หยุดให้บริการก่อนเข้า **ตั้งค่ารถและการเชื่อมต่อ**
7. ใส่รหัสรถให้ตรงกับ `SHUTTLE-01`, `SHUTTLE-02`, `SHUTTLE-03` และ bearer token ของคันนั้น
8. ใส่ HTTPS endpoint เป็น `https://<โดเมนของคุณ>/api/positions` โดยเปลี่ยนส่วนโดเมนเป็นของจริง
9. เริ่มให้บริการ แล้วเลือกคันเดียวกันบนเว็บ ตรวจอายุพิกัดและสถานะรับข้อมูล

การตั้งค่า Vercel deployment protection ต้องอนุญาตให้มือถือเรียก endpoint ได้ ตัวแอปไม่ได้ส่ง Vercel bypass cookie ใช้ driver token ที่ route ตรวจอยู่แล้วสำหรับการเขียนตำแหน่ง

## ตรวจสอบ

```sh
npm run typecheck
npm test
npm run build
```

ดูผลตรวจจริงและข้อจำกัดใน `../docs/web/VERIFICATION.md` และเหตุผลเลือกฐานข้อมูลใน `../docs/web/ARCHITECTURE.md`

หน้าเว็บรับข้อมูลหลังฐานข้อมูล commit ผ่าน WebSocket โดยไม่รอ polling interval แต่ยังมีความหน่วงจาก GPS มือถือ เครือข่าย function และ Realtime ไม่มีการรับประกันว่าถึงลูกบ้านทุกหนึ่งวินาที หากไม่มีข้อมูลใหม่เกิน 10 วินาที เว็บต้องแสดงตำแหน่งเก่าแทนการอ้างว่าสด

## ค่าใช้จ่ายและขอบเขต

ดูโควตาปัจจุบันที่ https://supabase.com/docs/guides/realtime/pricing และ https://vercel.com/docs/plans/hobby รถ 3 คันส่งทุกวินาที วันละ 12 ชั่วโมง 30 วัน จะเกิดประมาณ 3.888 ล้านคำขอรับข้อมูล เกินโควตา Vercel Hobby 1 ล้าน function invocations ที่ตรวจ ณ 5 พฤศจิกายน 2026

Supabase Free ระบุ 2 ล้าน realtime messages ต่อเดือน และ 200 peak connections จำนวนข้อความเพิ่มตามผู้ชมที่เปิดดู Vercel Hobby จำกัดการใช้แบบ personal non-commercial จึงไม่รับประกันว่าใช้กับบริการคอนโดได้ฟรีหรือเข้าเงื่อนไขแผนเสมอ เลือกแพ็กเกจให้ตรงการใช้งานจริง

แผนที่ใช้ OpenStreetMap tiles สำหรับเริ่มทดสอบ ต้องรักษา attribution และตรวจนโยบาย tile provider ก่อนใช้งานจำนวนมาก โค้ดเก็บเพียงตำแหน่งล่าสุดของแต่ละรถ ไม่มีประวัติเส้นทางและไม่มี ETA ที่เดาจากระยะเส้นตรง ตำแหน่งคอนโดและสถานีจริงยังรอข้อมูลจากผู้ใช้

## การทดสอบกับมือถือจริงที่เชื่อมต่อแล้ว

ทดสอบแอปประจำรถรุ่น 0.2.0 ส่ง GPS จริงของ SHUTTLE-01 ผ่าน `adb reverse tcp:3000 tcp:3000` เข้า API ในคอมพิวเตอร์ แล้วบันทึกและกระจายต่อผ่าน Supabase ได้แล้ว เปิดเว็บปกติที่ `http://localhost:3000/` โดยไม่ใช้ query `demo` หรือ `usb`

ระหว่างทดสอบแบบนี้ต้องเปิด Next.js ที่ port3000 เสียบ USB และเปิดให้บริการในแอป หากไม่มี GPS ใหม่ หน้าเว็บจะแสดงข้อมูลเก่าตามเวลา ไม่คงสถานะสดไว้เอง

ก่อนใช้โดยไม่ต่อ USB ให้ deploy บน Vercel ตั้งค่า env โดยใช้ค่าจริงของ URL และ publishable key สำหรับตัวแปร `NEXT_PUBLIC_` และตั้งคีย์เซิร์ฟเวอร์กับ `DRIVER_TOKENS_JSON` ให้ตรงกับใน `.env.local` ห้ามนำค่าที่เป็นข้อความ `${...}` ไปวางบน Vercel แทนค่าจริง จากนั้นเปลี่ยน endpoint ในแอปเป็น HTTPS URL ของ deployment รหัสรถและ token ของคันที่ 1 ตั้งในมือถือไว้แล้ว คีย์ลับ Supabase ไม่ได้อยู่ในมือถือ
