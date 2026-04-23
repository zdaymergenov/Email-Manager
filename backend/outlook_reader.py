"""
Модуль для чтения писем из Outlook
Stage 2: Расширенные данные для аналитики
"""

import re
from datetime import datetime
import threading

try:
    import win32com.client
except ImportError:
    raise ImportError("Требуется pywin32. Установите: pip install pywin32")


def extract_signature_from_html(html):
    """Ищет подпись в HTML-теле письма"""
    if not html:
        return ""
    patterns = [
        r'<div[^>]+(?:id|class)=["\'][^"\']*signature[^"\']*["\'][^>]*>(.*?)</div>',
        r'<div[^>]+(?:id|class)=["\'][^"\']*Signature[^"\']*["\'][^>]*>(.*?)</div>',
    ]
    for pat in patterns:
        m = re.search(pat, html, re.DOTALL | re.IGNORECASE)
        if m:
            return clean_html(m.group(1)).strip()
    return ""

_SIG_KEYWORDS = [
    "с уважением", "с наилучшими пожеланиями", "с пожеланиями",
    "искренне ваш", "с теплом",
    "best regards", "kind regards", "sincerely", "regards,",
    "thanks and regards", "warm regards", "yours faithfully",
    "yours sincerely", "cheers,",
]

_SIG_SEPARATORS = [
    "\n-- \n", "\n--\n", "\r\n-- \r\n",
    "\n" + "_" * 10,
    "\n" + "-" * 10,
]

def extract_signature_from_text(body):
    """Извлекает подпись из текстового тела письма"""
    if not body:
        return ""

    for sep in _SIG_SEPARATORS:
        idx = body.find(sep)
        if idx != -1:
            candidate = body[idx + len(sep):].strip()
            if candidate:
                return candidate[:500]

    lines = body.splitlines()
    for i, line in enumerate(lines):
        low = line.strip().lower()
        for kw in _SIG_KEYWORDS:
            if low.startswith(kw):
                sig = "\n".join(lines[i:]).strip()
                if sig:
                    return sig[:500]

    return ""

def get_signature(msg):
    """Получить подпись из письма"""
    try:
        html = msg.HTMLBody
        if html:
            sig = extract_signature_from_html(html)
            if sig:
                return sig
    except Exception:
        pass

    try:
        body = msg.Body
        if body:
            sig = extract_signature_from_text(body)
            if sig:
                return sig
    except Exception:
        pass

    return ""

def clean_html(text):
    """Очищает HTML от тегов"""
    if not text:
        return ""
    text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

def get_body(msg):
    """Получить тело письма"""
    try:
        body = msg.Body
        if body and len(body.strip()) > 10:
            return body.strip()
    except Exception:
        pass
    try:
        html = msg.HTMLBody
        if html:
            return clean_html(html)
    except Exception:
        pass
    return ""

def format_date(dt):
    """Форматировать дату"""
    try:
        return dt.strftime("%d.%m.%Y %H:%M")
    except Exception:
        return str(dt)

def get_size(msg):
    """Получить размер письма в байтах"""
    try:
        return msg.Size or 0
    except Exception:
        return 0

def get_attachments_count(msg):
    """Получить количество вложений"""
    try:
        return msg.Attachments.Count
    except Exception:
        return 0

def get_importance(msg):
    """Получить важность письма (0=low, 1=normal, 2=high)"""
    try:
        importance = msg.Importance
        if importance == 2:
            return 'high'
        elif importance == 0:
            return 'low'
        else:
            return 'normal'
    except Exception:
        return 'normal'

def get_is_read(msg):
    """Проверить, прочитано ли письмо"""
    try:
        return int(msg.UnRead == False)
    except Exception:
        return 0

def collect_folders(folder, result_list, depth=0):
    """Рекурсивно собирает все вложенные папки"""
    result_list.append(folder)
    try:
        for sub in folder.Folders:
            collect_folders(sub, result_list, depth + 1)
    except Exception:
        pass

def read_folder(folder, start_date, end_date, max_count=0):
    """Читает письма из одной папки за период с расширенными данными"""
    emails = []
    folder_name = folder.Name

    try:
        items = folder.Items
        items.Sort("[ReceivedTime]", True)
        count = items.Count
    except Exception as e:
        print(f"  ⚠️  Не удалось открыть '{folder_name}': {e}")
        return []

    if count == 0:
        return []

    limit = min(count, max_count) if max_count else count
    print(f"\n  📁 {folder_name}: {count} писем → фильтрую...")

    for i in range(1, limit + 1):
        try:
            item = items[i]

            if item.Class != 43:  # 43 = olMail
                continue

            try:
                dt = item.ReceivedTime
                item_date = datetime(dt.year, dt.month, dt.day, dt.hour, dt.minute)
            except Exception:
                continue

            if not (start_date <= item_date <= end_date):
                continue

            sender = ""
            try:
                sender = item.SenderName or item.SenderEmailAddress or ""
            except Exception:
                pass

            subject = ""
            try:
                subject = item.Subject or "(без темы)"
            except Exception:
                pass

            date_str = format_date(dt)
            body = get_body(item)
            signature = get_signature(item)
            
            # Stage 2: Расширенные данные
            size = get_size(item)
            attachments_count = get_attachments_count(item)
            importance = get_importance(item)
            is_read = get_is_read(item)

            # ВАЖНО: используем маленькие буквы чтобы совпадало с database.py!
            emails.append({
                "folder": folder_name,
                "from": sender,
                "email": item.SenderEmailAddress or "",
                "subject": subject,
                "date": date_str,
                "_date_obj": item_date,
                "body": body[:3000],
                "signature": signature,
                
                # Stage 2: Новые поля
                "size": size,
                "attachments_count": attachments_count,
                "importance": importance,
                "is_read": is_read,
            })

            if len(emails) % 50 == 0:
                print(f"    [{len(emails)}] {subject[:60]}")

        except Exception:
            continue

    return emails

def read_emails_by_date(start_date, end_date, scan_mode='inbox'):
    """
    Чтение писем из Outlook за период с расширенными данными
    Инициализация COM для текущего потока
    """
    import pythoncom
    
    print("\n" + "=" * 60)
    print("  ЧТЕНИЕ ПИСЕМ ИЗ OUTLOOK")
    print("=" * 60)

    print(f"\nПериод: {start_date.strftime('%d.%m.%Y')} - {end_date.strftime('%d.%m.%Y')}")
    print(f"Режим: {'Входящие' if scan_mode == 'inbox' else 'Все папки'}")
    print(f"Поток: {threading.current_thread().name}")

    try:
        pythoncom.CoInitialize()
        print("✅ COM инициализирован для текущего потока")
    except Exception as e:
        print(f"⚠️  COM уже активирован: {type(e).__name__}")

    try:
        outlook = win32com.client.Dispatch("Outlook.Application")
        ns = outlook.GetNamespace("MAPI")
        print("✅ Outlook подключён")
    except Exception as e:
        raise Exception(f"Не удалось подключиться к Outlook: {e}")

    try:
        root = ns.DefaultStore.GetRootFolder()
    except Exception as e:
        raise Exception(f"Не удалось получить папки: {e}")

    if scan_mode == 'all':
        all_folders = []
        collect_folders(root, all_folders)
        print(f"Найдено папок: {len(all_folders)}")
        folders_to_scan = all_folders
    else:
        folders_to_scan = [ns.GetDefaultFolder(6)]

    all_emails = []
    for folder in folders_to_scan:
        try:
            emails = read_folder(folder, start_date, end_date)
            all_emails.extend(emails)
        except Exception:
            continue

    if not all_emails:
        print(f"📭 Писем не найдено")
        return []

    all_emails.sort(key=lambda x: x["_date_obj"], reverse=True)

    print(f"\n{'='*60}")
    print(f"📊 Загружено: {len(all_emails)} писем")
    print(f"{'='*60}\n")

    return all_emails