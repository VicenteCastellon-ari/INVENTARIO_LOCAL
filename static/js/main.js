let audioCtx;

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

function realizarPeticion(url, opciones) {
  return fetch(url, opciones).then(res => res.json());
}

let pestañaActual = 'pos';
let modoPOS = 'venta';
let carrito = [];
const inputCodigo = document.getElementById('codigo_input');
const formAuto = document.getElementById('form_registro_auto');
const ultimoEscaneo = document.getElementById('ultimo_escaneo');
const statusBar = document.getElementById('status_bar');

if (inputCodigo) {
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
    if (pestañaActual === 'pos' && !formAuto.contains(e.target) && e.target.tagName !== 'BUTTON') {
      inputCodigo.focus();
    }
    actualizarEstadoFoco();
  });
  
  setInterval(actualizarEstadoFoco, 500);

  window.cambiarPestaña = function(pestaña) {
    pestañaActual = pestaña;
    
    document.querySelectorAll('.tab-btn').forEach((btn, i) => {
      btn.classList.toggle('active', i === (pestaña === 'pos' ? 0 : 1));
    });
    
    document.getElementById('panel_pos').classList.toggle('active', pestaña === 'pos');
    
    const pInv = document.getElementById('panel_inventario');
    if (pInv) {
      pInv.classList.toggle('active', pestaña === 'inventario');
    }
    
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
    
    const bi = document.getElementById('btn_ingreso');
    if (bi) {
      bi.classList.toggle('activo', modo === 'ingreso');
    }
    
    document.getElementById('carrito_container').style.display = modo === 'venta' ? 'block' : 'none';
    ultimoEscaneo.textContent = modo === 'venta' ? 'Modo Venta Activo' : 'Modo Ingreso Activo';
    ultimoEscaneo.style.color = '#1e3a8a';
    inputCodigo.focus();
  }

  document.addEventListener('keydown', (e) => {
    if (pestañaActual !== 'pos' || e.target.tagName === 'INPUT') return;
    
    if (e.key === 'F2') {
      e.preventDefault();
      cambiarModoPOS('venta');
    }
    if (e.key === 'F4' && document.getElementById('btn_ingreso')) {
      e.preventDefault();
      cambiarModoPOS('ingreso');
    }
    if (e.key === 'F8' || e.code === 'Space') {
      e.preventDefault();
      procesarCarrito();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      limpiarCarrito();
      formAuto.style.display = 'none';
    }
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo_barras: codigo })
    })
    .then(data => {
      if (data.status === 'nuevo') {
        beep(450, 200);
        setTimeout(() => beep(450, 200), 250);
        
        if (!document.getElementById('auto_codigo')) return;
        
        document.getElementById('auto_codigo').value = data.codigo;
        formAuto.style.display = 'block';
        ultimoEscaneo.textContent = 'Producto Desconocido';
        ultimoEscaneo.style.color = '#e67e22';
        document.getElementById('auto_categoria').focus();
      } else {
        if (modoPOS === 'venta') {
          agregarAlCarrito(data.producto);
        } else {
          registrarIngresoInmediato(codigo);
        }
      }
    })
    .catch(e => console.error(e));
  }

  function registrarIngresoInmediato(codigo) {
    realizarPeticion('/procesar_ingreso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo_barras: codigo })
    })
    .then(data => {
      if (data.status === 'ok') {
        beep(600, 100);
        ultimoEscaneo.textContent = `+1 ${data.nombre} (Stock: ${data.stock})`;
        ultimoEscaneo.style.color = '#16a34a';
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
    ultimoEscaneo.style.color = '#2563eb';
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
          <td>
            <button class="btn-qty" onclick="modCarrito(${idx}, -1)">-</button> 
            <span style="display:inline-block; width:20px; text-align:center;">${i.cantidad}</span> 
            <button class="btn-qty" onclick="modCarrito(${idx}, 1)">+</button>
          </td>
          <td style="font-weight:bold;">$${sub.toFixed(2)}</td>
        </tr>
      `;
    });
    
    document.getElementById('total_carrito').textContent = total.toFixed(2);
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
    ultimoEscaneo.style.color = '#dc2626';
    inputCodigo.focus();
  }

  window.procesarCarrito = function() {
    if (carrito.length === 0) return;
    
    realizarPeticion('/procesar_venta_lote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ carrito: carrito })
    })
    .then(data => {
      if (data.status === 'ok') {
        beep(600, 100);
        setTimeout(() => beep(800, 150), 150);
        carrito = [];
        renderizarCarrito();
        ultimoEscaneo.textContent = 'Venta Completada';
        ultimoEscaneo.style.color = '#16a34a';
      } else if (data.status === 'error_stock') {
        beep(150, 400);
        alert(`Stock insuficiente para: ${data.producto}`);
      }
      inputCodigo.focus();
    });
  }

  window.guardarProductoAuto = function() { guardarProd('auto'); }
  window.guardarProductoManual = function() { guardarProd('manual'); }

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
    })
    .then(res => {
      if (res.status === 'exito') {
        if (tipo === 'auto') {
          formAuto.style.display = 'none';
          ultimoEscaneo.textContent = `Registrado: ${d.nombre}`;
          ultimoEscaneo.style.color = '#16a34a';
          inputCodigo.focus();
        } else {
          cargarTablaInventario();
          document.getElementById('man_codigo').value = '';
          document.getElementById('man_categoria').value = '';
          document.getElementById('man_nombre').value = '';
          document.getElementById('man_precio').value = '';
        }
      }
    });
  }

  function cargarTablaInventario() {
    realizarPeticion('/obtener_productos', { method: 'GET' })
      .then(data => {
        const tbody = document.getElementById('tabla_productos_corps');
        tbody.innerHTML = '';
        
        data.forEach(p => {
          tbody.innerHTML += `
            <tr>
              <td><span class="badge">${p.categoria}</span></td>
              <td>
                <strong>${p.nombre}</strong><br>
                <small>${p.codigo_barras}</small>
              </td>
              <td style="color:${p.stock_actual <= p.stock_minimo ? 'red' : 'inherit'}">
                <strong>${p.stock_actual}</strong>
              </td>
              <td>
                <button class="btn-delete-row" onclick="eliminarProducto('${p.codigo_barras}')">Borrar</button>
              </td>
            </tr>
          `;
        });
      });
  }

  window.eliminarProducto = function(codigo) {
    if (confirm('¿Borrar permanente?')) {
      realizarPeticion('/eliminar_producto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo_barras: codigo })
      })
      .then(() => cargarTablaInventario());
    }
  }
}
