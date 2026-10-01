// Datos fijos de la app: categorías iniciales, colores, íconos elegibles y reglas base de categorización.

export const COLORS = [
  '#22c39a', '#3b82f6', '#f97316', '#ef4444', '#a855f7', '#ec4899',
  '#14b8a6', '#eab308', '#6366f1', '#84cc16', '#f43f5e', '#94a3b8',
];

export const DEFAULT_CATEGORIES = [
  { id: 'comida', name: 'Comida', color: '#f97316', icon: 'coffee', type: 'gasto' },
  { id: 'super', name: 'Supermercado', color: '#ef4444', icon: 'cart', type: 'gasto' },
  { id: 'transporte', name: 'Transporte', color: '#3b82f6', icon: 'truck', type: 'gasto' },
  { id: 'suscripciones', name: 'Suscripciones', color: '#ec4899', icon: 'tv', type: 'gasto' },
  { id: 'servicios', name: 'Servicios', color: '#eab308', icon: 'zap', type: 'gasto' },
  { id: 'arriendo', name: 'Arriendo', color: '#6366f1', icon: 'home', type: 'gasto' },
  { id: 'salud', name: 'Salud', color: '#14b8a6', icon: 'heart', type: 'gasto' },
  { id: 'ocio', name: 'Ocio', color: '#a855f7', icon: 'smile', type: 'gasto' },
  { id: 'otros', name: 'Otros', color: '#94a3b8', icon: 'dots', type: 'gasto' },
];

// Pseudo-categoría para lo que las reglas no pudieron resolver (categoryId = null).
export const UNCLASSIFIED = { id: null, name: 'Sin categoría', color: '#64748b', icon: 'help', type: null };

/**
 * Reglas base: palabras clave por categoría, ya normalizadas (minúsculas, sin tildes).
 * Una palabra de hasta 3 letras tiene que aparecer entera; las más largas alcanzan con que
 * una palabra de la descripción empiece así ("super" → "supermercado").
 * Si coinciden varias, gana la palabra clave más larga.
 */
export const BASE_KEYWORDS = {
  comida: [
    'almuerzo', 'cena', 'desayuno', 'merienda', 'cafe', 'cafeteria', 'restaurante', 'resto', 'pizza',
    'empanada', 'hamburguesa', 'burger', 'sushi', 'helado', 'delivery', 'pedidosya', 'pedidos ya', 'rappi',
    'mcdonald', 'starbucks', 'bar', 'cerveza', 'medialuna', 'panaderia', 'kiosco', 'gaseosa', 'comida',
    'parrilla', 'lomito', 'milanesa', 'facturas', 'snack', 'birra',
  ],
  super: [
    'super', 'supermercado', 'mercado', 'carrefour', 'coto', 'dia', 'jumbo', 'disco', 'vea', 'changomas',
    'walmart', 'almacen', 'verduleria', 'carniceria', 'dietetica', 'chino', 'fiambreria', 'mayorista',
  ],
  transporte: [
    'taxi', 'uber', 'cabify', 'didi', 'colectivo', 'bondi', 'subte', 'tren', 'sube', 'nafta', 'combustible',
    'gasolina', 'ypf', 'shell', 'axion', 'peaje', 'estacionamiento', 'parqueadero', 'parking', 'cochera',
    'remis', 'bici', 'pasaje', 'micro', 'lavadero', 'mecanico', 'vtv', 'patente',
  ],
  suscripciones: [
    'netflix', 'spotify', 'disney', 'hbo', 'max', 'prime', 'amazon prime', 'youtube', 'icloud', 'google one',
    'chatgpt', 'claude', 'paramount', 'crunchyroll', 'suscripcion', 'apple music', 'deezer', 'twitch',
  ],
  servicios: [
    'luz', 'agua', 'gas', 'internet', 'wifi', 'telefono', 'celular', 'movistar', 'claro', 'personal',
    'fibertel', 'telecentro', 'edenor', 'edesur', 'metrogas', 'aysa', 'expensas', 'abl', 'seguro', 'cable',
    'factura', 'impuesto', 'monotributo',
  ],
  arriendo: ['alquiler', 'arriendo', 'renta', 'inmobiliaria'],
  salud: [
    'farmacia', 'medico', 'doctor', 'dentista', 'odontologo', 'prepaga', 'osde', 'swiss medical', 'remedio',
    'medicamento', 'psicologo', 'terapia', 'gimnasio', 'gym', 'analisis', 'optica', 'kinesiologo', 'clinica',
  ],
  ocio: [
    'cine', 'teatro', 'recital', 'show', 'entrada', 'juego', 'steam', 'playstation', 'xbox', 'libro', 'viaje',
    'hotel', 'boliche', 'salida', 'museo', 'futbol', 'concierto', 'vacaciones', 'airbnb',
  ],
  sueldo: ['sueldo', 'salario', 'nomina', 'aguinaldo', 'honorarios', 'pago mensual'],
  'otros-ingresos': [
    'reintegro', 'reembolso', 'venta', 'vendi', 'transferencia', 'intereses', 'freelance', 'cobro', 'devolucion',
    'regalo', 'premio', 'plazo fijo',
  ],
};
