from flask import Flask, render_template, request, jsonify
import psycopg2
from psycopg2.extras import RealDictCursor
import os
import logging
import openpyxl

app = Flask(__name__)
logging.basicConfig(level=logging.ERROR)

DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://postgres:tu_contraseña@localhost:5432/inventario_db')

def obtener_conexion():
    return psycopg2.connect(DATABASE_URL)

def inicializar_bd_automatica():
    conn = obtener_conexion()
    try:
        cursor = conn.cursor()
        # Tablas base
        cursor.execute('''CREATE TABLE IF NOT EXISTS Productos (codigo_barras TEXT PRIMARY KEY, nombre TEXT NOT NULL, categoria TEXT NOT NULL, precio_venta REAL NOT NULL, stock_actual INTEGER DEFAULT 0, stock_minimo INTEGER DEFAULT 0, fecha_ingreso TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS Ventas (id SERIAL PRIMARY KEY, total REAL NOT NULL, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS DetalleVenta (id SERIAL PRIMARY KEY, venta_id INTEGER REFERENCES Ventas(id), codigo_producto TEXT REFERENCES Productos(codigo_barras), cantidad INTEGER, precio_unitario REAL, subtotal REAL)''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS Movimientos (id SERIAL PRIMARY KEY, codigo_producto TEXT REFERENCES Productos(codigo_barras), tipo TEXT, cantidad INTEGER, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        
        # Nuevas columnas para el sistema de Fiados y Abonos (ALTER para no borrar datos previos)
        cursor.execute("ALTER TABLE Ventas ADD COLUMN IF NOT EXISTS cliente_nombre TEXT DEFAULT 'General'")
        cursor.execute("ALTER TABLE Ventas ADD COLUMN IF NOT EXISTS estado_pago TEXT DEFAULT 'PAGADO'")
        cursor.execute("ALTER TABLE Ventas ADD COLUMN IF NOT EXISTS monto_pagado REAL DEFAULT 0")
        cursor.execute("ALTER TABLE Ventas ADD COLUMN IF NOT EXISTS monto_deuda REAL DEFAULT 0")
        
        # Nueva tabla de historial de abonos
        cursor.execute('''CREATE TABLE IF NOT EXISTS Abonos (id SERIAL PRIMARY KEY, venta_id INTEGER REFERENCES Ventas(id), monto REAL NOT NULL, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_movimientos_producto ON Movimientos(codigo_producto)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_detalle_venta ON DetalleVenta(venta_id)')
        conn.commit()
    finally:
        cursor.close()
        conn.close()

try:
    inicializar_bd_automatica()
except Exception:
    pass

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/info_producto', methods=['POST'])
def info_producto():
    codigo = request.get_json().get('codigo_barras')
    conn = obtener_conexion()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('SELECT * FROM Productos WHERE codigo_barras = %s', (codigo,))
        producto = cursor.fetchone()
        if producto:
            return jsonify({'status': 'ok', 'producto': dict(producto)})
        return jsonify({'status': 'nuevo', 'codigo': codigo})
    finally:
        conn.close()

@app.route('/procesar_ingreso', methods=['POST'])
def procesar_ingreso():
    codigo = request.get_json().get('codigo_barras')
    conn = obtener_conexion()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('SELECT * FROM Productos WHERE codigo_barras = %s', (codigo,))
        producto = cursor.fetchone()
        if producto:
            nuevo_stock = producto['stock_actual'] + 1
            cursor.execute('UPDATE Productos SET stock_actual = %s WHERE codigo_barras = %s', (nuevo_stock, codigo))
            cursor.execute('INSERT INTO Movimientos (codigo_producto, tipo, cantidad) VALUES (%s, %s, %s)', (codigo, 'INGRESO', 1))
            conn.commit()
            return jsonify({'status': 'ok', 'nombre': producto['nombre'], 'stock': nuevo_stock})
        return jsonify({'status': 'error'})
    except Exception:
        conn.rollback()
        return jsonify({'status': 'error'})
    finally:
        conn.close()

@app.route('/procesar_venta_lote', methods=['POST'])
def procesar_venta_lote():
    data = request.get_json()
    carrito = data.get('carrito', [])
    cliente = data.get('cliente', 'General')
    monto_pagado = float(data.get('monto_pagado', 0))
    es_fiado = data.get('es_fiado', False)

    if not carrito:
        return jsonify({'status': 'error'})
    
    conn = obtener_conexion()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        total_venta = sum(item['cantidad'] * item['precio_venta'] for item in carrito)
        
        # Calcular deudas
        if not es_fiado:
            monto_pagado = total_venta
            deuda = 0
            estado = 'PAGADO'
        else:
            deuda = total_venta - monto_pagado
            estado = 'DEUDA' if monto_pagado == 0 else 'ABONADO'

        cursor.execute('''
            INSERT INTO Ventas (total, cliente_nombre, estado_pago, monto_pagado, monto_deuda) 
            VALUES (%s, %s, %s, %s, %s) RETURNING id
        ''', (total_venta, cliente, estado, monto_pagado, deuda))
        venta_id = cursor.fetchone()['id']
        
        # Registrar primer abono si dio una parte
        if es_fiado and monto_pagado > 0:
            cursor.execute('INSERT INTO Abonos (venta_id, monto) VALUES (%s, %s)', (venta_id, monto_pagado))

        for item in carrito:
            cursor.execute('SELECT stock_actual FROM Productos WHERE codigo_barras = %s', (item['codigo_barras'],))
            prod = cursor.fetchone()
            if not prod or prod['stock_actual'] < item['cantidad']:
                conn.rollback()
                return jsonify({'status': 'error_stock', 'producto': item['nombre']})
            nuevo_stock = item['stock_actual'] - item['cantidad']
            cursor.execute('UPDATE Productos SET stock_actual = %s WHERE codigo_barras = %s', (nuevo_stock, item['codigo_barras']))
            cursor.execute('INSERT INTO DetalleVenta (venta_id, codigo_producto, cantidad, precio_unitario, subtotal) VALUES (%s, %s, %s, %s, %s)', (venta_id, item['codigo_barras'], item['cantidad'], item['precio_venta'], item['cantidad'] * item['precio_venta']))
            cursor.execute('INSERT INTO Movimientos (codigo_producto, tipo, cantidad) VALUES (%s, %s, %s)', (item['codigo_barras'], 'VENTA', item['cantidad']))
        
        conn.commit()
        return jsonify({'status': 'ok', 'venta_id': venta_id})
    except Exception as e:
        conn.rollback()
        logging.error(f"Error venta: {e}")
        return jsonify({'status': 'error'})
    finally:
        conn.close()

@app.route('/obtener_productos', methods=['GET'])
def obtener_productos():
    conn = obtener_conexion()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('SELECT * FROM Productos ORDER BY categoria ASC, nombre ASC')
        return jsonify([dict(row) for row in cursor.fetchall()])
    finally:
        conn.close()

@app.route('/guardar_producto', methods=['POST'])
def guardar_producto():
    datos = request.get_json()
    conn = obtener_conexion()
    try:
        cursor = conn.cursor()
        stock_inicial = int(datos.get('stock_inicial') or 0)
        cursor.execute('''
            INSERT INTO Productos (codigo_barras, nombre, categoria, precio_venta, stock_actual) 
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (codigo_barras) DO UPDATE 
            SET nombre = EXCLUDED.nombre,
                categoria = EXCLUDED.categoria,
                precio_venta = EXCLUDED.precio_venta,
                stock_actual = Productos.stock_actual + EXCLUDED.stock_actual
        ''', (datos['codigo'], datos['nombre'], datos['categoria'], float(datos['precio']), stock_inicial))
        
        if stock_inicial > 0:
            cursor.execute('INSERT INTO Movimientos (codigo_producto, tipo, cantidad) VALUES (%s, %s, %s)', 
                           (datos['codigo'], 'INGRESO_MANUAL', stock_inicial))
        conn.commit()
        return jsonify({'status': 'exito'})
    except Exception as e:
        logging.error(f"Error guardando/actualizando producto: {e}")
        return jsonify({'status': 'error'})
    finally:
        conn.close()

@app.route('/eliminar_producto', methods=['POST'])
def eliminar_producto():
    codigo = request.get_json().get('codigo_barras')
    conn = obtener_conexion()
    try:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM Productos WHERE codigo_barras = %s', (codigo,))
        conn.commit()
        return jsonify({'status': 'exito'})
    finally:
        conn.close()

@app.route('/importar_excel', methods=['POST'])
def importar_excel():
    if 'archivo' not in request.files:
        return jsonify({'status': 'error', 'message': 'No se envió ningún archivo'})
    file = request.files['archivo']
    if file.filename == '':
        return jsonify({'status': 'error', 'message': 'Archivo vacío'})
    try:
        wb = openpyxl.load_workbook(file)
        sheet = wb.active
        conn = obtener_conexion()
        cursor = conn.cursor()
        filas_procesadas = 0
        for row in sheet.iter_rows(min_row=2, values_only=True):
            codigo = str(row[0]).strip() if row[0] else None
            nombre = str(row[1]).strip() if row[1] else None
            categoria = str(row[2]).strip() if row[2] else 'General'
            precio = float(row[3]) if row[3] else 0.0
            stock = int(row[4]) if row[4] else 0
            if not codigo or not nombre:
                continue
            cursor.execute('''
                INSERT INTO Productos (codigo_barras, nombre, categoria, precio_venta, stock_actual)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (codigo_barras) DO UPDATE 
                SET nombre = EXCLUDED.nombre,
                    categoria = EXCLUDED.categoria,
                    precio_venta = EXCLUDED.precio_venta,
                    stock_actual = Productos.stock_actual + EXCLUDED.stock_actual
            ''', (codigo, nombre, categoria, precio, stock))
            if stock > 0:
                cursor.execute('INSERT INTO Movimientos (codigo_producto, tipo, cantidad) VALUES (%s, %s, %s)', (codigo, 'INGRESO_MASIVO', stock))
            filas_procesadas += 1
        conn.commit()
        return jsonify({'status': 'exito', 'filas': filas_procesadas})
    except Exception as e:
        logging.error(f"Error Excel: {e}")
        return jsonify({'status': 'error', 'message': 'Asegúrate de subir el archivo .xlsx correcto.'})
    finally:
        conn.close()

# --- NUEVAS RUTAS PARA CRÉDITOS ---
@app.route('/obtener_deudas', methods=['GET'])
def obtener_deudas():
    conn = obtener_conexion()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT id, cliente_nombre, total, monto_pagado, monto_deuda, TO_CHAR(fecha, 'DD/MM/YYYY HH12:MI AM') as fecha_fmt FROM Ventas WHERE monto_deuda > 0 ORDER BY fecha DESC")
        return jsonify([dict(row) for row in cursor.fetchall()])
    finally:
        conn.close()

@app.route('/procesar_abono', methods=['POST'])
def procesar_abono():
    data = request.get_json()
    venta_id = data.get('venta_id')
    abono = float(data.get('monto', 0))
    
    conn = obtener_conexion()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('SELECT total, monto_pagado, monto_deuda FROM Ventas WHERE id = %s', (venta_id,))
        venta = cursor.fetchone()
        
        if not venta: return jsonify({'status': 'error', 'msg': 'Venta no encontrada'})
        
        nuevo_pagado = venta['monto_pagado'] + abono
        nueva_deuda = venta['total'] - nuevo_pagado
        estado = 'PAGADO' if nueva_deuda <= 0 else 'ABONADO'
        
        cursor.execute('UPDATE Ventas SET monto_pagado = %s, monto_deuda = %s, estado_pago = %s WHERE id = %s', (nuevo_pagado, max(0, nueva_deuda), estado, venta_id))
        cursor.execute('INSERT INTO Abonos (venta_id, monto) VALUES (%s, %s)', (venta_id, abono))
        conn.commit()
        
        return jsonify({'status': 'ok'})
    except Exception as e:
        conn.rollback()
        return jsonify({'status': 'error'})
    finally:
        conn.close()

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
