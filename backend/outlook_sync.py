# outlook_sync.py - Модуль синхронизации с Outlook

import win32com.client
from datetime import datetime, timedelta
import pythoncom
import re

def clean_html(html_text):
    """Очистить HTML от тегов"""
    if not html_text:
        return ""
    
    # Удаляем HTML теги
    clean = re.compile('<.*?>')
    text = re.sub(clean, ' ', html_text)
    
    # Удаляем лишние пробелы и переносы
    text = re.sub(r'\s+', ' ', text)
    
    return text.strip()

def extract_signature(body):
    """Извлечь подпись из тела письма"""
    if not body:
        return "", body
    
    # Ищем маркеры подписи
    signature_markers = [
        '--', '___', '***',
        'Best regards', 'Kind regards', 'Sincerely',
        'С уважением', 'С наилучшими пожеланиями'
    ]
    
    body_lower = body.lower()
    signature = ""
    main_body = body
    
    for marker in signature_markers:
        marker_lower = marker.lower()
        if marker_lower in body_lower:
            idx = body_lower.find(marker_lower)
            signature = body[idx:].strip()
            main_body = body[:idx].strip()
            break
    
    return signature, main_body

def fetch_outlook_emails(period_hours=24, folder_name="Входящие", max_emails=None):
    """
    Получить письма из Outlook
    
    Args:
        period_hours: период в часах (24 = последние 24 часа)
        folder_name: имя папки ("Входящие", "Отправленные", и т.д.)
        max_emails: максимальное количество писем (None = без ограничений)
    
    Returns:
        list: список словарей с данными писем
    """
    pythoncom.CoInitialize()
    
    try:
        outlook = win32com.client.Dispatch("Outlook.Application")
        namespace = outlook.GetNamespace("MAPI")
        
        # Получаем нужную папку
        if folder_name == "Входящие":
            folder = namespace.GetDefaultFolder(6)  # olFolderInbox
        elif folder_name == "Отправленные":
            folder = namespace.GetDefaultFolder(5)  # olFolderSentMail
        elif folder_name == "Черновики":
            folder = namespace.GetDefaultFolder(16)  # olFolderDrafts
        elif folder_name == "Удаленные":
            folder = namespace.GetDefaultFolder(3)  # olFolderDeletedItems
        else:
            # Пробуем найти папку по имени
            try:
                folder = namespace.Folders.Item(folder_name)
            except:
                folder = namespace.GetDefaultFolder(6)  # По умолчанию Входящие
        
        messages = folder.Items
        messages.Sort("[ReceivedTime]", True)  # Сортировка по дате (новые сначала)
        
        # Фильтруем по дате
        cutoff_date = datetime.now() - timedelta(hours=period_hours)
        cutoff_date = cutoff_date.strftime("%m/%d/%Y %H:%M:%S")
        
        emails = []
        count = 0
        
        print(f"📥 Сканирую папку '{folder_name}' за последние {period_hours} часов...")
        
        for message in messages:
            try:
                # Проверяем дату
                if hasattr(message, 'ReceivedTime'):
                    received_time = message.ReceivedTime
                    if received_time < datetime.strptime(cutoff_date, "%m/%d/%Y %H:%M:%S"):
                        break  # Дальше письма старее
                
                # Извлекаем данные
                subject = message.Subject if hasattr(message, 'Subject') else ""
                sender_name = message.SenderName if hasattr(message, 'SenderName') else ""
                
                # Email отправителя
                sender_email = ""
                if hasattr(message, 'SenderEmailAddress'):
                    sender_email = message.SenderEmailAddress
                elif hasattr(message, 'Sender') and hasattr(message.Sender, 'Address'):
                    sender_email = message.Sender.Address
                
                # Тело письма
                body = ""
                if hasattr(message, 'HTMLBody') and message.HTMLBody:
                    body = clean_html(message.HTMLBody)
                elif hasattr(message, 'Body') and message.Body:
                    body = message.Body
                
                # Извлекаем подпись
                signature, clean_body = extract_signature(body)
                
                # Conversation ID (для веток)
                conversation_id = ""
                if hasattr(message, 'ConversationID'):
                    conversation_id = message.ConversationID
                
                # Вложения
                attachments_count = message.Attachments.Count if hasattr(message, 'Attachments') else 0
                
                # Важность
                importance = "normal"
                if hasattr(message, 'Importance'):
                    if message.Importance == 2:  # olImportanceHigh
                        importance = "high"
                    elif message.Importance == 0:  # olImportanceLow
                        importance = "low"
                
                # Прочитано ли
                is_read = not message.UnRead if hasattr(message, 'UnRead') else False
                
                # Размер
                size = message.Size if hasattr(message, 'Size') else 0
                
                email_data = {
                    'folder': folder_name,
                    'from': sender_name,
                    'email': sender_email,
                    'subject': subject,
                    'body': clean_body[:5000] if clean_body else "",  # Ограничиваем размер
                    'signature': signature[:1000] if signature else "",
                    'date': received_time.strftime("%Y-%m-%d %H:%M:%S") if hasattr(message, 'ReceivedTime') else "",
                    '_date_obj': received_time if hasattr(message, 'ReceivedTime') else datetime.now(),
                    'size': size,
                    'attachments_count': attachments_count,
                    'importance': importance,
                    'is_read': 1 if is_read else 0,
                    'is_replied': 0,  # Нужно проверять отдельно
                    'conversation_id': conversation_id
                }
                
                emails.append(email_data)
                count += 1
                
                # Показываем прогресс
                if count % 10 == 0:
                    print(f"   📧 Обработано {count} писем...")
                
                # Ограничение по количеству
                if max_emails and count >= max_emails:
                    break
                    
            except Exception as e:
                print(f"   ⚠️ Ошибка при обработке письма: {e}")
                continue
        
        print(f"✅ Найдено {len(emails)} писем в папке '{folder_name}'")
        return emails
        
    except Exception as e:
        print(f"❌ Ошибка при подключении к Outlook: {e}")
        return []
    finally:
        pythoncom.CoUninitialize()

def sync_all_folders(period_hours=24, folders=None):
    """
    Синхронизировать письма из нескольких папок
    
    Args:
        period_hours: период в часах
        folders: список папок (по умолчанию ["Входящие", "Отправленные"])
    
    Returns:
        dict: статистика синхронизации
    """
    if folders is None:
        folders = ["Входящие", "Отправленные"]
    
    all_emails = []
    stats = {
        'total': 0,
        'by_folder': {}
    }
    
    for folder in folders:
        print(f"\n📁 Синхронизация папки: {folder}")
        emails = fetch_outlook_emails(period_hours, folder)
        
        stats['by_folder'][folder] = len(emails)
        stats['total'] += len(emails)
        all_emails.extend(emails)
    
    return all_emails, stats

def get_outlook_folders():
    """Получить список доступных папок Outlook"""
    pythoncom.CoInitialize()
    
    try:
        outlook = win32com.client.Dispatch("Outlook.Application")
        namespace = outlook.GetNamespace("MAPI")
        
        folders = []
        
        # Стандартные папки
        standard_folders = {
            6: "Входящие",
            5: "Отправленные",
            16: "Черновики",
            3: "Удаленные",
            9: "Исходящие",
            10: "Нежелательная почта"
        }
        
        for folder_id, folder_name in standard_folders.items():
            try:
                folder = namespace.GetDefaultFolder(folder_id)
                count = folder.Items.Count
                folders.append({
                    'name': folder_name,
                    'count': count,
                    'id': folder_id
                })
            except:
                pass
        
        return folders
        
    except Exception as e:
        print(f"❌ Ошибка получения папок: {e}")
        return []
    finally:
        pythoncom.CoUninitialize()

# Тестовая функция
if __name__ == "__main__":
    print("🧪 Тест синхронизации с Outlook\n")
    
    # Получаем папки
    print("📁 Доступные папки:")
    folders = get_outlook_folders()
    for f in folders:
        print(f"   - {f['name']}: {f['count']} писем")
    
    # Синхронизируем последние 24 часа
    print("\n🔄 Синхронизация последних 24 часов...")
    emails = fetch_outlook_emails(period_hours=24, folder_name="Входящие", max_emails=5)
    
    print(f"\n✅ Получено {len(emails)} писем:")
    for i, email in enumerate(emails[:3], 1):
        print(f"\n{i}. От: {email['from']} <{email['email']}>")
        print(f"   Тема: {email['subject']}")
        print(f"   Дата: {email['date']}")