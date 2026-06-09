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
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
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
  if (pestañaActual === 'pos' && document.activeElement === inputCodigo) {
    statusBar.className = 'status-bar activo';
    statusBar.textContent = 'Lector Activo: Listo para escanear';
  } else if (pestañaActual === 'pos') {
    statusBar.className = 'status-bar inactivo';
    statusBar.textContent = 'Escáner Bloqueado: Toca aquí para reactivar';
  }
}

document.addEventListener('click', (e) => {
  if (pestañaActual === 'pos' && !formAuto.contains(e.target) && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
    inputCodigo.focus();
  }
  actualizarEstadoFoco();
});

setInterval(actualizarEstadoFoco, 500);
cargarTasaBCV();

window.cambiarPestaña = function(pestaña) {
  pestañaActual = pestaña;
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === (pestaña === 'pos' ? 0 : 1));
  });
  document.getElementById('panel_pos').classList.toggle('active', pestaña === 'pos');
  document.getElementById('panel_inventario').classList.toggle('active', pestaña === 'inventario');
  if (pestaña === 'inventario') {
    cargarTablaInventario();
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
  ultimoEscaneo.style.color = '#1e3a8a';
  inputCodigo.focus();
}

document.addEventListener('keydown', (e) => {
  if (pestañaActual !== 'pos' || (e.target.tagName === 'INPUT' && e.target.id !== 'codigo_input')) {
    return;
  }
  if (e.key === 'F2') { e.preventDefault(); cambiarModoPOS('venta'); }
  if (e.key === 'F4') { e.preventDefault(); cambiarModoPOS('ingreso'); }
  if (e.key === 'F8' || e.code === 'Space') { e.preventDefault(); procesarCarrito(); }
  if (e.key === 'Escape') { e.preventDefault(); limpiarCarrito(); formAuto.style.display = 'none'; }
});

inputCodigo.addEventListener('keypress', function(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    let c = inputCodigo.value.trim();
    if (c) {
      procesarEscaneo(c);
    }
    inputCodigo.value = '';
  }
});

function procesarEscaneo(codigo) {
  formAuto.style.display = 'none';
  realizarPeticion('/info_producto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo_barras: codigo })
  }).then(data => {
    if (data.status === 'nuevo') {
      beep(450, 200); 
      setTimeout(() => beep(450, 200), 250);
      document.getElementById('auto_codigo').value = data.codigo;
      formAuto.style.display = 'block';
      ultimoEscaneo.textContent = 'Producto Desconocido';
      ultimoEscaneo.style.color = '#ef4444';
      document.getElementById('auto_categoria').focus();
    } else {
      if (modoPOS === 'venta') {
        agregarAlCarrito(data.producto);
      } else {
        registrarIngresoInmediato(codigo);
      }
    }
  });
}

function registrarIngresoInmediato(codigo) {
  realizarPeticion('/procesar_ingreso', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo_barras: codigo })
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
  if (item) {
    item.cantidad++;
  } else {
    carrito.push({ ...prod, cantidad: 1 });
  }
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
    tbody.innerHTML += `
      <tr>
        <td>${i.nombre}</td>
        <td style="text-align: center;">
          <button class="btn-qty" onclick="modCarrito(${idx}, -1)">-</button> 
          <span style="display:inline-block; width:25px; text-align:center;">${i.cantidad}</span> 
          <button class="btn-qty" onclick="modCarrito(${idx}, 1)">+</button>
        </td>
        <td style="font-weight:bold; text-align: right;">$${sub.toFixed(2)}</td>
      </tr>
    `;
  });
  document.getElementById('total_carrito').textContent = total.toFixed(2);
  document.getElementById('total_bs').textContent = (total * (tasaBCV || 0)).toFixed(2);
}

window.modCarrito = function(index, val) {
  carrito[index].cantidad += val;
  if (carrito[index].cantidad <= 0) {
    carrito.splice(index, 1);
  }
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

function imprimirTicket(carrito, total, totalBs, id) {
  const ticket = document.getElementById('ticket-print');
  let date = new Date().toLocaleString('es-VE');
  let trs = carrito.map(i => `
    <tr>
      <td>${i.cantidad}x ${i.nombre}</td>
      <td>$${(i.cantidad * i.precio_venta).toFixed(2)}</td>
    </tr>
  `).join('');
  ticket.innerHTML = `
    <div class="ticket-header">
      <h3>Inventario POS</h3>
      <p>Ticket #${id}<br>${date}</p>
    </div>
    <table class="ticket-table">
      <thead>
        <tr>
          <th>Desc</th>
          <th>Monto</th>
        </tr>
      </thead>
      <tbody>
        ${trs}
      </tbody>
    </table>
    <div class="ticket-total">
      TOTAL: $${total.toFixed(2)}<br>
      REF: Bs. ${totalBs.toFixed(2)}
    </div>
    <p style="text-align:center; margin-top:20px;">¡Gracias por su compra!</p>
  `;
  window.print();
}

window.procesarCarrito = function() {
  if (carrito.length === 0) {
    return;
  }
  let carritoActual = [...carrito];
  let totalUsd = parseFloat(document.getElementById('total_carrito').textContent);
  let totalBs = parseFloat(document.getElementById('total_bs').textContent);
  realizarPeticion('/procesar_venta_lote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ carrito: carritoActual })
  }).then(data => {
    if (data.status === 'ok') {
      beep(600, 100); 
      setTimeout(() => beep(800, 150), 150);
      imprimirTicket(carritoActual, totalUsd, totalBs, data.venta_id);
      carrito = [];
      renderizarCarrito();
      ultimoEscaneo.textContent = 'Venta Completada';
      ultimoEscaneo.style.color = '#10b981';
    } else if (data.status === 'error_stock') {
      beep(150, 400);
      showToast(`Stock insuficiente: ${data.producto}`, 'error');
    }
    inputCodigo.focus();
  });
}

window.guardarProductoAuto = function() { 
  guardarProd('auto'); 
}

window.guardarProductoManual = function() { 
  guardarProd('manual'); 
}

function guardarProd(tipo) {
  let d = tipo === 'auto' ? {
    codigo: document.getElementById('auto_codigo').value, 
    categoria: document.getElementById('auto_categoria').value, 
    nombre: document.getElementById('auto_nombre').value, 
    precio: document.getElementById('auto_precio').value, 
    stock_inicial: 1
  } : {
    codigo: document.getElementById('man_codigo').value, 
    categoria: document.getElementById('man_categoria').value, 
    nombre: document.getElementById('man_nombre').value, 
    precio: document.getElementById('man_precio').value, 
    stock_inicial: document.getElementById('man_stock').value
  };
  realizarPeticion('/guardar_producto', {
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(d)
  }).then(res => {
    if (res.status === 'exito') {
      showToast('Producto guardado correctamente');
      if (tipo === 'auto') {
        formAuto.style.display = 'none';
        ultimoEscaneo.textContent = `Registrado: ${d.nombre}`;
        ultimoEscaneo.style.color = '#10b981';
        inputCodigo.focus();
      } else {
        cargarTablaInventario();
        ['man_codigo','man_categoria','man_nombre','man_precio'].forEach(id => {
          document.getElementById(id).value = '';
        });
      }
    }
  });
}

function cargarTablaInventario() {
  realizarPeticion('/obtener_productos', { method: 'GET' }).then(data => {
    const tbody = document.getElementById('tabla_productos_corps');
    const selectCategoria = document.getElementById('filtro_categoria');
    tbody.innerHTML = '';
    
    // Armar las categorías únicas en el selector
    const categoriasUnicas = [...new Set(data.map(p => p.categoria || 'General'))].sort();
    selectCategoria.innerHTML = '<option value="todas">Todas las categorías</option>';
    categoriasUnicas.forEach(cat => {
      selectCategoria.innerHTML += `<option value="${cat.toLowerCase()}">${cat}</option>`;
    });

    data.forEach(p => {
      let catData = (p.categoria || 'General').toLowerCase();
      tbody.innerHTML += `
        <tr class="fila-producto" data-nombre="${p.nombre.toLowerCase()}" data-codigo="${p.codigo_barras}" data-categoria="${catData}">
          <td><span class="badge">${p.categoria}</span></td>
          <td>
            <strong>${p.nombre}</strong><br>
            <small>${p.codigo_barras}</small>
          </td>
          <td style="color:${p.stock_actual <= p.stock_minimo ? 'red' : 'inherit'}; text-align: center;">
            <strong>${p.stock_actual}</strong>
          </td>
          <td style="text-align: center;">
            <button class="btn-delete-row" onclick="eliminarProducto('${p.codigo_barras}')">Borrar</button>
          </td>
        </tr>
      `;
    });
  });
}

function aplicarFiltros() {
  const textoBusqueda = document.getElementById('buscador_inv').value.toLowerCase();
  const categoriaSeleccionada = document.getElementById('filtro_categoria').value;
  document.querySelectorAll('.fila-producto').forEach(row => {
    const coincideTexto = row.dataset.nombre.includes(textoBusqueda) || row.dataset.codigo.includes(textoBusqueda);
    const coincideCategoria = categoriaSeleccionada === 'todas' || row.dataset.categoria === categoriaSeleccionada;
    row.style.display = (coincideTexto && coincideCategoria) ? '' : 'none';
  });
}

document.getElementById('buscador_inv').addEventListener('keyup', aplicarFiltros);
document.getElementById('filtro_categoria').addEventListener('change', aplicarFiltros);

window.eliminarProducto = function(codigo) {
  if (confirm('¿Borrar permanente?')) {
    realizarPeticion('/eliminar_producto', {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ codigo_barras: codigo })
    }).then(() => { 
      showToast('Eliminado', 'warning'); 
      cargarTablaInventario(); 
    });
  }
}

window.subirExcelMasivo = function() {
  const input = document.getElementById('archivo_excel');
  if (input.files.length === 0) return;
  const archivo = input.files[0];
  const formData = new FormData();
  formData.append('archivo', archivo);
  showToast('Procesando Excel, por favor espera...', 'warning');
  fetch('/importar_excel', {
    method: 'POST',
    body: formData
  })
  .then(res => res.json())
  .then(data => {
    if (data.status === 'exito') {
      showToast(`¡Éxito! Importados/Actualizados ${data.filas} productos.`);
      cargarTablaInventario();
    } else {
      showToast(data.message, 'error');
    }
    input.value = '';
  })
  .catch(e => {
    showToast('Error subiendo el archivo', 'error');
    input.value = '';
  });
}
