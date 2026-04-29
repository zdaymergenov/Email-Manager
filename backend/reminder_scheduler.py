"""
reminder_scheduler.py - Фоновый поток для обработки напоминаний каждые 15 минут
"""

import threading
import time
import dispatch_db as ddb

_scheduler_thread = None
_running = False


def _scheduler_loop():
    global _running
    while _running:
        try:
            processed = ddb.process_due_reminders()
            if processed:
                print(f"🔔 Scheduler: обработано {processed} напоминаний")
        except Exception as e:
            print(f"⚠️ Scheduler error: {e}")
        time.sleep(900)  # каждые 15 минут


def start_reminder_scheduler():
    global _scheduler_thread, _running
    if _scheduler_thread and _scheduler_thread.is_alive():
        return
    _running = True
    _scheduler_thread = threading.Thread(target=_scheduler_loop, daemon=True, name='ReminderScheduler')
    _scheduler_thread.start()
    print("✅ Reminder scheduler запущен (каждые 15 минут)")


def stop_reminder_scheduler():
    global _running
    _running = False
    print("⏹️ Reminder scheduler остановлен")
