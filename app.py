from flask import Flask, render_template, request, jsonify
import psycopg2
from psycopg2.extras import RealDictCursor
import os
import logging

app = Flask(__name__)
logging.basicConfig(level=logging.ERROR)

DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://postgres:tu_contraseña@localhost:5432/inventario_db')

def obtener_conexion():
    return psycopg2.connect(DATABASE_URL)

def inicializar_bd_automatica():
    conn = obtener_conexion()
    try:
        cursor = conn.cursor()
        cursor.execute('''CREATE TABLE IF NOT EXISTS Productos (codigo_barras TEXT PRIMARY KEY, nombre TEXT NOT NULL, categoria TEXT NOT NULL, precio_venta REAL NOT NULL, stock_actual INTEGER DEFAULT 0, stock_minimo INTEGER DEFAULT 0, fecha_ingreso TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS Ventas (id SERIAL PRIMARY KEY, total REAL NOT NULL, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS DetalleVenta (id SERIAL PRIMARY KEY, venta_id INTEGER REFERENCES Ventas(id), codigo_producto TEXT REFERENCES Productos(codigo_barras), cantidad INTEGER, precio_unitario REAL, subtotal REAL)''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS Movimientos (id SERIAL PRIMARY KEY, codigo_producto TEXT REFERENCES Productos(codigo_barras), tipo TEXT, cantidad INTEGER, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
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
    carrito = request.get_json().get('carrito', [])
    if not carrito:
        return jsonify({'status': 'error'})
    conn = obtener_conexion()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        total_venta = sum(item['cantidad'] * item['precio_venta'] for item in carrito)
        cursor.execute('INSERT INTO Ventas (total) VALUES (%s) RETURNING id', (total_venta,))
        venta_id = cursor.fetchone()['id']
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
    except Exception:
        conn.rollback()
        return jsonify({'status': 'error'})
    finally:
        conn.close()

@app.route('/obtener_productos', methods=['GET'])
def obtener_productos():
    conn = obtener_conexion()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('SELECT * FROM Productos ORDER BY categoria ASC, nombre ASC LIMIT 200')
        return jsonify([dict(row) for row in cursor.fetchall()])
    finally:
        conn.close()

@app.route('/guardar_producto', methods=['POST'])
def guardar_producto():
    datos = request.get_json()
    conn = obtener_conexion()
    try:
        cursor = conn.cursor()
        cursor.execute('INSERT INTO Productos (codigo_barras, nombre, categoria, precio_venta, stock_actual) VALUES (%s, %s, %s, %s, %s)', (datos['codigo'], datos['nombre'], datos['categoria'], float(datos['precio']), int(datos.get('stock_inicial', 1))))
        cursor.execute('INSERT INTO Movimientos (codigo_producto, tipo, cantidad) VALUES (%s, %s, %s)', (datos['codigo'], 'INGRESO_INICIAL', int(datos.get('stock_inicial', 1))))
        conn.commit()
        return jsonify({'status': 'exito'})
    except Exception:
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

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
