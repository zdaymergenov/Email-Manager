# filters_api.py - API endpoints для системы фильтров (v2)
"""
REST API для управления фильтрами и их применения
"""

from flask import Blueprint, request, jsonify
from functools import wraps
from filters_system_v2 import (
    create_filter, update_filter, delete_filter, get_filter,
    get_user_filters, toggle_favorite_filter,
    apply_filter, apply_saved_filter, get_quick_filter,
    get_all_quick_filters, get_filter_statistics,
    clear_filter_cache, validate_filter_config,
    init_filter_tables
)
import database as db

# Создаем Blueprint
filters_bp = Blueprint('filters', __name__, url_prefix='/api/filters')

# Инициализируем таблицы при импорте
init_filter_tables()

def require_login(f):
    """Декоратор для проверки аутентификации"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Получаем user_id из сессии (Flask)
        from flask import session
        if 'user_id' not in session:
            return jsonify({'error': 'Unauthorized'}), 401
        kwargs['user_id'] = session.get('user_id')
        return f(*args, **kwargs)
    return decorated_function

# ==================== УПРАВЛЕНИЕ СОХРАНЕННЫМИ ФИЛЬТРАМИ ====================

@filters_bp.route('/saved', methods=['GET'])
@require_login
def list_saved_filters(user_id):
    """Получить все сохраненные фильтры пользователя"""
    try:
        favorites_only = request.args.get('favorites_only', 'false').lower() == 'true'
        filters = get_user_filters(user_id, favorites_only)
        return jsonify({
            'success': True,
            'filters': filters,
            'count': len(filters)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@filters_bp.route('/saved', methods=['POST'])
@require_login
def create_saved_filter(user_id):
    """Создать новый фильтр"""
    try:
        data = request.get_json()
        
        # Валидация входных данных
        if not data.get('name'):
            return jsonify({'error': 'Filter name is required'}), 400
        
        if not data.get('filter_config'):
            return jsonify({'error': 'Filter config is required'}), 400
        
        # Валидируем конфиг
        is_valid, message = validate_filter_config(data['filter_config'])
        if not is_valid:
            return jsonify({'error': message}), 400
        
        # Создаем фильтр
        filter_id = create_filter(
            user_id=user_id,
            name=data['name'],
            filter_config=data['filter_config'],
            description=data.get('description', '')
        )
        
        if filter_id:
            return jsonify({
                'success': True,
                'message': 'Filter created successfully',
                'filter_id': filter_id
            }), 201
        else:
            return jsonify({'error': 'Failed to create filter'}), 500
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@filters_bp.route('/saved/<int:filter_id>', methods=['GET'])
@require_login
def get_saved_filter(user_id, filter_id):
    """Получить конкретный сохраненный фильтр"""
    try:
        filter_data = get_filter(filter_id)
        
        if not filter_data:
            return jsonify({'error': 'Filter not found'}), 404
        
        # Проверяем, что это фильтр пользователя
        if filter_data['user_id'] != user_id:
            return jsonify({'error': 'Unauthorized'}), 403
        
        return jsonify({
            'success': True,
            'filter': filter_data
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@filters_bp.route('/saved/<int:filter_id>', methods=['PUT'])
@require_login
def update_saved_filter(user_id, filter_id):
    """Обновить сохраненный фильтр"""
    try:
        # Проверяем, что это фильтр пользователя
        filter_data = get_filter(filter_id)
        if not filter_data or filter_data['user_id'] != user_id:
            return jsonify({'error': 'Unauthorized or filter not found'}), 403
        
        data = request.get_json()
        
        if data.get('filter_config'):
            # Валидируем новый конфиг
            is_valid, message = validate_filter_config(data['filter_config'])
            if not is_valid:
                return jsonify({'error': message}), 400
        
        success = update_filter(
            filter_id=filter_id,
            filter_config=data.get('filter_config', filter_data['filter_config']),
            name=data.get('name')
        )
        
        if success:
            # Очищаем кеш для этого фильтра
            clear_filter_cache(filter_id)
            
            return jsonify({
                'success': True,
                'message': 'Filter updated successfully'
            })
        else:
            return jsonify({'error': 'Failed to update filter'}), 500
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@filters_bp.route('/saved/<int:filter_id>', methods=['DELETE'])
@require_login
def delete_saved_filter(user_id, filter_id):
    """Удалить сохраненный фильтр"""
    try:
        # Проверяем, что это фильтр пользователя
        filter_data = get_filter(filter_id)
        if not filter_data or filter_data['user_id'] != user_id:
            return jsonify({'error': 'Unauthorized or filter not found'}), 403
        
        if delete_filter(filter_id):
            return jsonify({
                'success': True,
                'message': 'Filter deleted successfully'
            })
        else:
            return jsonify({'error': 'Failed to delete filter'}), 500
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@filters_bp.route('/saved/<int:filter_id>/favorite', methods=['PUT'])
@require_login
def toggle_filter_favorite(user_id, filter_id):
    """Отметить/отметить фильтр как избранный"""
    try:
        # Проверяем, что это фильтр пользователя
        filter_data = get_filter(filter_id)
        if not filter_data or filter_data['user_id'] != user_id:
            return jsonify({'error': 'Unauthorized or filter not found'}), 403
        
        if toggle_favorite_filter(filter_id):
            filter_data = get_filter(filter_id)
            return jsonify({
                'success': True,
                'message': 'Filter favorite status updated',
                'is_favorite': filter_data['is_favorite']
            })
        else:
            return jsonify({'error': 'Failed to update favorite status'}), 500
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ==================== ПРИМЕНЕНИЕ ФИЛЬТРОВ ====================

@filters_bp.route('/apply', methods=['POST'])
@require_login
def apply_custom_filter(user_id):
    """Применить пользовательский фильтр"""
    try:
        data = request.get_json()
        
        filter_config = data.get('filter_config', {})
        page = data.get('page', 1)
        per_page = data.get('per_page', 20)
        
        # Валидируем конфиг
        is_valid, message = validate_filter_config(filter_config)
        if not is_valid:
            return jsonify({'error': message}), 400
        
        result = apply_filter(filter_config, page, per_page)
        
        return jsonify({
            'success': True,
            'data': result
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@filters_bp.route('/saved/<int:filter_id>/apply', methods=['GET'])
@require_login
def apply_filter_endpoint(user_id, filter_id):
    """Применить сохраненный фильтр"""
    try:
        # Проверяем, что это фильтр пользователя
        filter_data = get_filter(filter_id)
        if not filter_data or filter_data['user_id'] != user_id:
            return jsonify({'error': 'Unauthorized or filter not found'}), 403
        
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        
        result = apply_saved_filter(filter_id, page, per_page)
        
        return jsonify({
            'success': True,
            'data': result
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ==================== БЫСТРЫЕ ФИЛЬТРЫ ====================

@filters_bp.route('/quick', methods=['GET'])
def list_quick_filters():
    """Получить список всех быстрых фильтров"""
    try:
        quick_filters = get_all_quick_filters()
        return jsonify({
            'success': True,
            'filters': quick_filters
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@filters_bp.route('/quick/<filter_key>/apply', methods=['GET'])
def apply_quick_filter(filter_key):
    """Применить быстрый фильтр"""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        
        result = get_quick_filter(filter_key, page, per_page)
        
        if 'error' in result:
            return jsonify(result), 404
        
        return jsonify({
            'success': True,
            'data': result
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ==================== СТАТИСТИКА И ИНФОРМАЦИЯ ====================

@filters_bp.route('/statistics', methods=['GET'])
def get_statistics():
    """Получить статистику по фильтрам"""
    try:
        stats = get_filter_statistics()
        return jsonify({
            'success': True,
            'statistics': stats
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@filters_bp.route('/cache/clear', methods=['POST'])
@require_login
def clear_cache(user_id):
    """Очистить кеш фильтров"""
    try:
        filter_id = request.json.get('filter_id') if request.json else None
        
        if clear_filter_cache(filter_id):
            return jsonify({
                'success': True,
                'message': 'Cache cleared successfully'
            })
        else:
            return jsonify({'error': 'Failed to clear cache'}), 500
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ==================== СПРАВОЧНАЯ ИНФОРМАЦИЯ ====================

@filters_bp.route('/available-fields', methods=['GET'])
def get_available_fields():
    """Получить доступные поля для фильтрации"""
    try:
        available_fields = {
            'position': {
                'name': 'Должность',
                'type': 'select',
                'endpoint': '/api/positions'
            },
            'department': {
                'name': 'Отдел',
                'type': 'select',
                'endpoint': '/api/departments'
            },
            'folder': {
                'name': 'Папка',
                'type': 'select',
                'endpoint': '/api/folders'
            },
            'sender_email': {
                'name': 'Email отправителя',
                'type': 'text'
            },
            'subject_contains': {
                'name': 'Содержание в теме',
                'type': 'text'
            },
            'date_range_days': {
                'name': 'Дней назад',
                'type': 'number'
            },
            'date_from': {
                'name': 'От даты',
                'type': 'date'
            },
            'date_to': {
                'name': 'По дату',
                'type': 'date'
            },
            'unread_only': {
                'name': 'Только непрочитанные',
                'type': 'boolean'
            },
            'has_attachments': {
                'name': 'С вложениями',
                'type': 'boolean'
            },
            'important_only': {
                'name': 'Только важные',
                'type': 'boolean'
            },
            'replied_only': {
                'name': 'Только отвеченные',
                'type': 'boolean'
            }
        }
        
        return jsonify({
            'success': True,
            'fields': available_fields
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def register_filters_blueprint(app):
    """Регистрировать Blueprint в Flask приложении"""
    app.register_blueprint(filters_bp)
    print("✅ Filters API Blueprint зарегистрирован")
