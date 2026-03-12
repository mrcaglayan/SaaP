BANKA İLE CARİ ÖDEME VE RECİVE ALMA.
BANKAYA PARA TRANFSERİ BANKADAN PARA TRANSFERİ GELME (KASADAN BANKAYA)
BANKA STATEMNTI YÜKLEME
BANKAYA PARA TRANFSERİ BANKADAN PARA TRANSFERİ GELME (BANKADAN KASAYA DA OLUYOR MU ARAŞTIR)
I’ve got the exact edge case now: the system protects against importing the same bank line twice and against auto-posting the same statement line twice, but it does not magically know that you already booked the same business event in cash unless you reconcile it to that existing posting.
YUKARIDAKİNDE AÇIKLTA CONSOLİDE OLMAYANLARI BELKİ UYARI VERİR EŞLEŞENE KADAR CAPAMA FİLAN OLMAZ.

DB’ye seedledim. Üç kullanıcı tenant 1 altında AF01 için LEGAL_ENTITY scope ile aktif durumda:

finance.operator@af01.local -> FinanceOperator
finance.checker@af01.local -> FinanceChecker
finance.auditor@af01.local -> FinanceAuditor
Ortak şifre: Temp1234!

Repo dosyası değiştirmedim; bu işlem sadece DB’ye yazıldı. İstersen şimdi bu kullanıcılarla hızlı login/doğrulama senaryosuna geçelim ya da doğrudan step 10 Konsolidasyon Kurulumuna ilerleyelim.
