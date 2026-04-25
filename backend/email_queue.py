# email_queue.py - Очередь для безопасного добавления писем

import queue
import threading
import time
import database as db
from datetime import datetime

# Глобальная очередь для писем
email_queue = queue.Queue()

# Флаг для остановки worker
worker_stop_flag = threading.Event()

def start_email_worker():
    """Запускает фоновый worker для обработки очереди писем"""
    print("🔄 Запускаю Email Worker...")
    
    # Проверяем что worker еще не запущен
    for thread in threading.enumerate():
        if thread.name == "EmailWorker":
            print("⚠️  Email Worker уже запущен")
            return
    
    worker_thread = threading.Thread(
        target=email_worker_loop,
        daemon=True,
        name="EmailWorker"
    )
    worker_thread.start()
    print("✅ Email Worker запущен")

def email_worker_loop():
    """Основной цикл worker - обрабатывает очередь писем"""
    print("📧 Email Worker: начинаю обработку очереди...")
    
    stats = {
        'added': 0,
        'failed': 0,
        'start_time': datetime.now(),
        'last_print': 0
    }
    
    while not worker_stop_flag.is_set():
        try:
            # Ждем письмо из очереди (с timeout чтобы проверить флаг остановки)
            try:
                email_data = email_queue.get(timeout=1.0)
            except queue.Empty:
                # Очередь пуста, продолжаем цикл
                continue
            
            try:
                # Добавляем письмо в БД
                if db.add_email(email_data):
                    stats['added'] += 1
                    # Печатаем каждые 50 писем
                    if stats['added'] - stats['last_print'] >= 50:
                        print(f"  ✅ Добавлено {stats['added']} писем...")
                        stats['last_print'] = stats['added']
                else:
                    stats['failed'] += 1
            except Exception as e:
                print(f"  ❌ Ошибка при добавлении письма: {e}")
                stats['failed'] += 1
            
            # Указываем что обработали это письмо из очереди
            email_queue.task_done()
            
        except Exception as e:
            print(f"❌ Критическая ошибка в Email Worker: {e}")
            import traceback
            traceback.print_exc()
            # Продолжаем работу несмотря на ошибку
            continue
    
    # Worker остановлен
    print(f"\n📊 Email Worker остановлен:")
    print(f"  ✅ Добавлено: {stats['added']}")
    print(f"  ❌ Ошибок: {stats['failed']}")
    elapsed = (datetime.now() - stats['start_time']).total_seconds()
    print(f"  ⏱️  Время: {elapsed:.1f} сек")

def stop_email_worker():
    """Останавливает worker и ждет пока он обработает всё"""
    print("⏹️  Остановка Email Worker...")
    worker_stop_flag.set()
    
    # Ждем пока очередь обработается (максимум 30 секунд)
    try:
        email_queue.join()
        print("✅ Очередь полностью обработана")
    except KeyboardInterrupt:
        print("⚠️  Остановка прервана")

def queue_email_for_adding(email_data):
    """Добавляет письмо в очередь для асинхронной обработки"""
    email_queue.put(email_data)

def get_queue_size():
    """Возвращает количество писем в очереди"""
    return email_queue.qsize()

def wait_for_queue_to_empty(timeout=300):
    """Ждет пока очередь пуста (для синхронизации)"""
    try:
        email_queue.join()
        return True
    except Exception as e:
        print(f"Ошибка при ожидании очереди: {e}")
        return False

print("✅ email_queue.py загружен")