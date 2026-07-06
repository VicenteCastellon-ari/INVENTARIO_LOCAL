let audioCtx;
let pestañaActual = 'pos';
let modoPOS = 'venta';
let carrito = [];
let tasaBCV = 0;

const inputCodigo = document.getElementById('codigo_input');
const formAuto = document.getElementById('form_registro_auto');
const ultimoEscaneo = document.getElementById('ultimo_escaneo');
const statusBar = document.getElementById('status_bar');

function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function beep(f, d, v = 0.1) {
  try {
    initAudio();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g);
    g.connect(audioCtx.destination);
    o.frequency.value = f;
    g.gain.value = v;
    o.start();
    setTimeout(() => o.stop(), d);
  } catch (e) {}
}

function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function realizarPeticion(url, opciones) {
  return fetch(url, opciones).then(res => res.json());
}

async function cargarTasaBCV() {
  try {
    const res = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
    const data = await res.json();
    tasaBCV = data.promedio;
    document.getElementById('tasa_bcv_display').textContent = tasaBCV.toFixed(2);
    renderizarCarrito();
  } catch (e) {
    document.getElementById('tasa_bcv_display').textContent = 'Error API';
  }
}

function actualizarEstadoFoco() {
  const overlay = document.getElementById('modal_overlay');
  if (overlay.style.display === 'flex') return; // Pausar escáner si hay modal abierto

  if (pestañaActual === 'pos' && document.activeElement === inputCodigo) {
    statusBar.className = 'status-bar activo';
    statusBar.textContent = 'Lector Activo: Listo para escanear';
  } else if (pestañaActual === 'pos') {
    statusBar.className = 'status-bar inactivo';
    statusBar.textContent = 'Escáner Bloqueado: Toca aquí para reactivar';
  }
}

document.addEventListener('click', (e) => {
  const overlay = document.getElementById('modal_overlay');
  if (overlay.style.display === 'flex') return;

  if (pestañaActual === 'pos' && !formAuto.contains(e.target) && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
    inputCodigo.focus();
  }
  actualizarEstadoFoco();
});

setInterval(actualizarEstadoFoco, 500);
cargarTasaBCV();

window.cambiarPestaña = function(pestaña) {
  pestañaActual = pestaña;
  const botones = document.querySelectorAll('.tab-btn');
  botones[0].classList.toggle('active', pestaña === 'pos');
  botones[1].classList.toggle('active', pestaña === 'inventario');
  botones[2].classList.toggle('active', pestaña === 'creditos');

  document.getElementById('panel_pos').classList.toggle('active', pestaña === 'pos');
  document.getElementById('panel_inventario').classList.toggle('active', pestaña === 'inventario');
  document.getElementById('panel_creditos').classList.toggle('active', pestaña === 'creditos');

  if (pestaña === 'inventario') {
    cargarTablaInventario();
    statusBar.style.display = 'none';
  } else if (pestaña === 'creditos') {
    cargarTablaDeudas();
    statusBar.style.display = 'none';
  } else {
    statusBar.style.display = 'block';
    inputCodigo.focus();
  }
}

window.cambiarModoPOS = function(modo) {
  modoPOS = modo;
  document.getElementById('btn_venta').classList.toggle('activo', modo === 'venta');
  document.getElementById('btn_ingreso').classList.toggle('activo', modo === 'ingreso');
  document.getElementById('carrito_container').style.display = modo === 'venta' ? 'block' : 'none';
  ultimoEscaneo.textContent = modo === 'venta' ? 'Modo Venta Activo' : 'Modo Ingreso Activo';
  ultimoEscaneo.style.color = '#0044cc';
  inputCodigo.focus();
}

document.addEventListener('keydown', (e) => {
  const overlay = document.getElementById('modal_overlay');
  if (overlay.style.display === 'flex') return;

  if (pestañaActual !== 'pos' || (e.target.tagName === 'INPUT' && e.target.id !== 'codigo_input')) return;
  
  if (e.key === 'F2') { e.preventDefault(); cambiarModoPOS('venta'); }
  if (e.key === 'F4') { e.preventDefault(); cambiarModoPOS('ingreso'); }
  if (e.key === 'F8' || e.code === 'Space') { e.preventDefault(); abrirModalPago(); }
  if (e.key === 'Escape') { e.preventDefault(); limpiarCarrito(); formAuto.style.display = 'none'; }
});

inputCodigo.addEventListener('keypress', function(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    let c = inputCodigo.value.trim();
    if (c) procesarEscaneo(c);
    inputCodigo.value = '';
  }
});

function procesarEscaneo(codigo) {
  formAuto.style.display = 'none';
  realizarPeticion('/info_producto', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo_barras: codigo })
  }).then(data => {
    if (data.status === 'nuevo') {
      beep(450, 200); setTimeout(() => beep(450, 200), 250);
      document.getElementById('auto_codigo').value = data.codigo;
      formAuto.style.display = 'block';
      ultimoEscaneo.textContent = 'Producto Desconocido';
      ultimoEscaneo.style.color = '#ef4444';
      document.getElementById('auto_categoria').focus();
    } else {
      modoPOS === 'venta' ? agregarAlCarrito(data.producto) : registrarIngresoInmediato(codigo);
    }
  });
}

function registrarIngresoInmediato(codigo) {
  realizarPeticion('/procesar_ingreso', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo_barras: codigo })
  }).then(data => {
    if (data.status === 'ok') {
      beep(600, 100);
      ultimoEscaneo.textContent = `+1 ${data.nombre} (Stock: ${data.stock})`;
      ultimoEscaneo.style.color = '#10b981';
    }
  });
}

function agregarAlCarrito(prod) {
  let item = carrito.find(i => i.codigo_barras === prod.codigo_barras);
  item ? item.cantidad++ : carrito.push({ ...prod, cantidad: 1 });
  beep(600, 100);
  ultimoEscaneo.textContent = prod.nombre;
  ultimoEscaneo.style.color = '#0044cc';
  renderizarCarrito();
}

function renderizarCarrito() {
  const tbody = document.getElementById('tabla_carrito');
  tbody.innerHTML = '';
  let total = 0;
  carrito.forEach((i, idx) => {
    let sub = i.cantidad * i.precio_venta;
    total += sub;
    tbody.innerHTML += `<tr>
      <td>${i.nombre}</td>
      <td style="text-align: center;">
        <button class="btn-qty" onclick="modCarrito(${idx}, -1)">-</button> 
        <span style="display:inline-block; width:25px; text-align:center;">${i.cantidad}</span> 
        <button class="btn-qty" onclick="modCarrito(${idx}, 1)">+</button>
      </td>
      <td style="font-weight:bold; text-align: right;">$${sub.toFixed(2)}</td>
    </tr>`;
  });
  document.getElementById('total_carrito').textContent = total.toFixed(2);
  document.getElementById('total_bs').textContent = (total * (tasaBCV || 0)).toFixed(2);
}

window.modCarrito = function(index, val) {
  carrito[index].cantidad += val;
  if (carrito[index].cantidad <= 0) carrito.splice(index, 1);
  renderizarCarrito();
  inputCodigo.focus();
}

window.limpiarCarrito = function() {
  carrito = [];
  renderizarCarrito();
  ultimoEscaneo.textContent = 'Operación Cancelada';
  ultimoEscaneo.style.color = '#ef4444';
  inputCodigo.focus();
}

/* --- LOGICA DEL MODAL DE PAGOS Y FIADOS --- */
window.abrirModalPago = function() {
  if (carrito.length === 0) return;
  document.getElementById('modal_total_usd').textContent = document.getElementById('total_carrito').textContent;
  document.getElementById('modal_overlay').style.display = 'flex';
  document.getElementById('tipo_pago').value = 'contado';
  toggleFormularioFiado();
}

window.cerrarModalPago = function() {
  document.getElementById('modal_overlay').style.display = 'none';
  inputCodigo.focus();
}

window.toggleFormularioFiado = function() {
  const esFiado = document.getElementById('tipo_pago').value === 'fiado';
  document.getElementById('form_fiado').style.display = esFiado ? 'block' : 'none';
  if (esFiado) document.getElementById('cliente_nombre').focus();
}

window.confirmarVentaFinal = function() {
  const tipo = document.getElementById('tipo_pago').value;
  const esFiado = tipo === 'fiado';
  let cliente = 'General';
  let abonado = 0;

  if (esFiado) {
    cliente = document.getElementById('cliente_nombre').value.trim();
    abonado = parseFloat(document.getElementById('monto_abonado').value) || 0;
    if (!cliente) {
      showToast('Ingresa el nombre del cliente para poder fiar', 'error');
      return;
    }
  }

  const payload = { carrito: [...carrito], cliente: cliente, monto_pagado: abonado, es_fiado: esFiado };
  let totalUsd = parseFloat(document.getElementById('total_carrito').textContent);
  let totalBs = parseFloat(document.getElementById('total_bs').textContent);

  realizarPeticion('/procesar_venta_lote', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  }).then(data => {
    if (data.status === 'ok') {
      beep(600, 100); setTimeout(() => beep(800, 150), 150);
      cerrarModalPago();
      imprimirTicket([...carrito], totalUsd, totalBs, data.venta_id, cliente, esFiado, abonado);
      carrito = [];
      renderizarCarrito();
      document.getElementById('cliente_nombre').value = '';
      document.getElementById('monto_abonado').value = '';
      ultimoEscaneo.textContent = 'Venta Procesada';
      ultimoEscaneo.style.color = '#10b981';
    } else if (data.status === 'error_stock') {
      beep(150, 400); showToast(`Stock insuficiente: ${data.producto}`, 'error');
    }
  });
}

function imprimirTicket(carrito, total, totalBs, id, cliente, esFiado, abonado) {
  const ticket = document.getElementById('ticket-print');
  let date = new Date().toLocaleString('es-VE');
  let trs = carrito.map(i => `<tr><td>${i.cantidad}x ${i.nombre}</td><td>$${(i.cantidad * i.precio_venta).toFixed(2)}</td></tr>`).join('');
  
  let pieTicket = `TOTAL: $${total.toFixed(2)}<br>REF: Bs. ${totalBs.toFixed(2)}`;
  if (esFiado) {
    pieTicket += `<br><br><b>CLIENTE:</b> ${cliente.toUpperCase()}<br><b>ABONÓ:</b> $${abonado.toFixed(2)}<br><b>DEUDA RESTANTE:</b> $${(total - abonado).toFixed(2)}`;
  }

  ticket.innerHTML = `
    <div class="ticket-header">
      <h3>Inventario POS</h3>
      <p>Ticket #${id}<br>${date}</p>
    </div>
    <table class="ticket-table">
      <thead><tr><th>Desc</th><th>Monto</th></tr></thead>
      <tbody>${trs}</tbody>
    </table>
    <div class="ticket-total">${pieTicket}</div>
    <p style="text-align:center; margin-top:20px;">¡Gracias por su compra!</p>
  `;
  window.print();
}

/* --- LOGICA DE INVENTARIO --- */
window.guardarProductoAuto = function() { guardarProd('auto'); }
window.guardarProductoManual = function() { guardarProd('manual'); }

function guardarProd(tipo) {
  let d = tipo === 'auto' ? {
    codigo: document.getElementById('auto_codigo').value, categoria: document.getElementById('auto_categoria').value, nombre: document.getElementById('auto_nombre').value, precio: document.getElementById('auto_precio').value, stock_inicial: 1
  } : {
    codigo: document.getElementById('man_codigo').value, categoria: document.getElementById('man_categoria').value, nombre: document.getElementById('man_nombre').value, precio: document.getElementById('man_precio').value, stock_inicial: document.getElementById('man_stock').value
  };
  realizarPeticion('/guardar_producto', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d)
  }).then(res => {
    if (res.status === 'exito') {
      showToast('Guardado correctamente');
      if (tipo === 'auto') {
        formAuto.style.display = 'none'; ultimoEscaneo.textContent = `Registrado: ${d.nombre}`; inputCodigo.focus();
      } else {
        cargarTablaInventario();
        ['man_codigo','man_categoria','man_nombre','man_precio','man_stock'].forEach(id => document.getElementById(id).value = (id==='man_stock'?'1':''));
      }
    }
  });
}

function cargarTablaInventario() {
  realizarPeticion('/obtener_productos', { method: 'GET' }).then(data => {
    const tbody = document.getElementById('tabla_productos_corps');
    const selectCategoria = document.getElementById('filtro_categoria');
    tbody.innerHTML = '';
    const categoriasUnicas = [...new Set(data.map(p => p.categoria || 'General'))].sort();
    selectCategoria.innerHTML = '<option value="todas">Todas las categorías</option>';
    categoriasUnicas.forEach(cat => { selectCategoria.innerHTML += `<option value="${cat.toLowerCase()}">${cat}</option>`; });

    data.forEach(p => {
      let catData = (p.categoria || 'General').toLowerCase();
      tbody.innerHTML += `<tr class="fila-producto" data-nombre="${p.nombre.toLowerCase()}" data-codigo="${p.codigo_barras}" data-categoria="${catData}">
        <td><span class="badge">${p.categoria}</span></td>
        <td><strong>${p.nombre}</strong><br><small>${p.codigo_barras}</small></td>
        <td style="color:${p.stock_actual <= p.stock_minimo ? 'red' : 'inherit'}; text-align: center;"><strong>${p.stock_actual}</strong></td>
        <td style="text-align: center;"><button class="btn-delete-row" onclick="eliminarProducto('${p.codigo_barras}')">Borrar</button></td>
      </tr>`;
    });
  });
}

function aplicarFiltros() {
  const text = document.getElementById('buscador_inv').value.toLowerCase();
  const cat = document.getElementById('filtro_categoria').value;
  document.querySelectorAll('.fila-producto').forEach(row => {
    const okText = row.dataset.nombre.includes(text) || row.dataset.codigo.includes(text);
    const okCat = cat === 'todas' || row.dataset.categoria === cat;
    row.style.display = (okText && okCat) ? '' : 'none';
  });
}
document.getElementById('buscador_inv').addEventListener('keyup', aplicarFiltros);
document.getElementById('filtro_categoria').addEventListener('change', aplicarFiltros);

window.eliminarProducto = function(codigo) {
  if (confirm('¿Borrar permanente?')) {
    realizarPeticion('/eliminar_producto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo_barras: codigo })
    }).then(() => { showToast('Eliminado', 'warning'); cargarTablaInventario(); });
  }
}

window.subirExcelMasivo = function() {
  const input = document.getElementById('archivo_excel');
  if (input.files.length === 0) return;
  const formData = new FormData(); formData.append('archivo', input.files[0]);
  showToast('Procesando Excel...', 'warning');
  fetch('/importar_excel', { method: 'POST', body: formData }).then(res => res.json()).then(data => {
    if (data.status === 'exito') { showToast(`¡Éxito! Procesados ${data.filas} productos.`); cargarTablaInventario(); } 
    else { showToast(data.message, 'error'); }
    input.value = '';
  }).catch(e => { showToast('Error subiendo', 'error'); input.value = ''; });
}

/* --- LOGICA DE CREDITOS Y ABONOS --- */
function cargarTablaDeudas() {
  realizarPeticion('/obtener_deudas', { method: 'GET' }).then(data => {
    const tbody = document.getElementById('tabla_deudas');
    tbody.innerHTML = '';
    data.forEach(d => {
      tbody.innerHTML += `<tr>
        <td><strong>${d.cliente_nombre.toUpperCase()}</strong><br><small>${d.fecha_fmt}</small></td>
        <td>$${d.total.toFixed(2)}</td>
        <td style="color: var(--danger-red); font-weight: bold;">$${d.monto_deuda.toFixed(2)}</td>
        <td style="text-align: center;">
          <button class="btn-qty" style="background: var(--primary-deep-blue); color: white;" onclick="registrarAbono(${d.id}, '${d.cliente_nombre}', ${d.monto_deuda})">Abonar</button>
        </td>
      </tr>`;
    });
  });
}

window.registrarAbono = function(ventaId, cliente, deudaActual) {
  let monto = prompt(`¿Cuánto va a abonar ${cliente}?\nDeuda actual: $${deudaActual.toFixed(2)}`);
  if (!monto) return;
  monto = parseFloat(monto);
  if (isNaN(monto) || monto <= 0 || monto > deudaActual) {
    showToast('Monto inválido', 'error');
    return;
  }

  realizarPeticion('/procesar_abono', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ venta_id: ventaId, monto: monto })
  }).then(data => {
    if (data.status === 'ok') {
      showToast('Abono registrado con éxito');
      cargarTablaDeudas();
    } else {
      showToast('Error procesando abono', 'error');
    }
  });
}
