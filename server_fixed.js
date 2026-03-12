const express = require('express');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');

// ============================================================
// VALIDACIÓN DE VARIABLES DE AMBIENTE
// ============================================================
const requiredEnvVars = [
  'CLAUDE_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_WHATSAPP_NUMBER',
  'OWNER_PHONE'
];

const missingVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingVars.length > 0) {
  console.error('❌ ERROR: Variables de ambiente faltantes:', missingVars);
  process.exit(1);
}

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ============================================================
// INICIALIZAR CLIENTES CON ERROR HANDLING
// ============================================================
let anthropic;
let twilioClient;

try {
  anthropic = new Anthropic({
    apiKey: process.env.CLAUDE_API_KEY
  });
  console.log('✅ Cliente Anthropic inicializado');
} catch (error) {
  console.error('❌ Error inicializando Anthropic:', error.message);
  process.exit(1);
}

try {
  twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  console.log('✅ Cliente Twilio inicializado');
} catch (error) {
  console.error('❌ Error inicializando Twilio:', error.message);
  process.exit(1);
}

// In-memory sessions
const sessions = {};

// ============================================================
// MENÚ PRINCIPAL
// ============================================================
const WELCOME_MESSAGE = `¡Bienvenido a *Márquez Body Shop*! 🚗✨
Somos su taller de hojalatería y pintura de confianza.

Por favor seleccione una opción:

1️⃣ *Agendar cita* para estimado en persona
2️⃣ *Tuve un accidente* — necesito ayuda
3️⃣ *Estimado para aseguradora*

_Responda con el número de su opción (1, 2 o 3)_`;

// ============================================================
// SYSTEM PROMPTS
// ============================================================
const PROMPT_CITA = `Eres Sofía, la asistente virtual de Márquez Body Shop, taller de hojalatería y pintura. Eres amable, profesional y eficiente. Hablas en español principalmente, pero si el cliente escribe en inglés, respondes en inglés.

El cliente quiere AGENDAR UNA CITA para un estimado en persona.

INFORMACIÓN QUE DEBES RECOPILAR EN ORDEN:
1. Nombre completo
2. Email
3. Número de celular
4. Información del vehículo — pregunta si prefiere:
   a) Enviar foto de la LICENCIA DEL VEHÍCULO (más fácil)
   b) Proveer manualmente: Placa, Marca, Modelo, Año y VIN number
   ⚠️ El VIN number es OBLIGATORIO
5. Descripción breve del daño
6. Preferencia de fecha/hora para la cita

INFORMACIÓN OPCIONAL:
- Nombre de la aseguradora
- Nombre del ajustador

REGLAS:
- Haz 1-2 preguntas a la vez
- Si envían foto de licencia, confirma que la recibiste
- Cuando tengas todo, muestra el RESUMEN COMPLETO
- Sé paciente y amable

FORMATO DEL RESUMEN FINAL:
━━━━━━━━━━━━━━━━━━━━━━
📋 *RESUMEN DE CITA*
Márquez Body Shop
━━━━━━━━━━━━━━━━━━━━━━
👤 *CLIENTE:*
• Nombre: [nombre]
• Email: [email]
• Celular: [celular]

🚗 *VEHÍCULO:*
• Placa: [placa]
• Marca/Modelo/Año: [info]
• VIN: [vin]

🔧 *DAÑO:*
[descripción]

📅 *CITA PREFERIDA:*
[fecha/hora]

🏢 *SEGURO (opcional):*
• Aseguradora: [nombre o "No aplica"]
• Ajustador: [nombre o "No aplica"]
━━━━━━━━━━━━━━━━━━━━━━
¿Es correcta toda esta información? ✅`;

const PROMPT_ACCIDENTE = `Eres Sofía, la asistente virtual de Márquez Body Shop, taller de hojalatería y pintura. Eres amable, empática y profesional. Hablas en español principalmente, pero si el cliente escribe en inglés, respondes en inglés.

El cliente TUVO UN ACCIDENTE. Primero muestra empatía y pregunta si está bien físicamente.

INFORMACIÓN QUE DEBES RECOPILAR EN ORDEN:
1. Primero pregunta: ¿Está usted bien? ¿Hay heridos?
2. Nombre completo
3. Email
4. Número de celular
5. Información del vehículo — pregunta si prefiere:
   a) Enviar foto de la LICENCIA DEL VEHÍCULO
   b) Proveer manualmente: Placa, Marca, Modelo, Año y VIN number
   ⚠️ El VIN number es OBLIGATORIO
6. Fotos del daño — pídele que las envíe por este chat
7. Descripción del accidente y daños visibles

INFORMACIÓN OPCIONAL:
- Nombre de la aseguradora
- Nombre del ajustador
- Número de claim/reclamación

REGLAS:
- Sé especialmente empático al inicio
- Recuérdale que está en buenas manos
- Cuando tengas todo, muestra el RESUMEN COMPLETO

FORMATO DEL RESUMEN FINAL:
━━━━━━━━━━━━━━━━━━━━━━
🚨 *REPORTE DE ACCIDENTE*
Márquez Body Shop
━━━━━━━━━━━━━━━━━━━━━━
👤 *CLIENTE:*
• Nombre: [nombre]
• Email: [email]
• Celular: [celular]

🚗 *VEHÍCULO:*
• Placa: [placa]
• Marca/Modelo/Año: [info]
• VIN: [vin]

💥 *DAÑOS DESCRITOS:*
[descripción]

📸 Fotos: [recibidas/pendientes]

🏢 *SEGURO:*
• Aseguradora: [nombre o "No provisto"]
• Ajustador: [nombre o "No provisto"]
• Claim #: [número o "No provisto"]
━━━━━━━━━━━━━━━━━━━━━━
¿Es correcta toda esta información? ✅`;

const PROMPT_ASEGURADORA = `Eres Sofía, la asistente virtual de Márquez Body Shop, taller de hojalatería y pintura. Eres amable, profesional y eficiente. Hablas en español principalmente, pero si el cliente escribe en inglés, respondes en inglés.

El cliente necesita un ESTIMADO PARA SU ASEGURADORA.

INFORMACIÓN QUE DEBES RECOPILAR EN ORDEN:
1. Nombre completo
2. Email
3. Número de celular
4. Información del vehículo — pregunta si prefiere:
   a) Enviar foto de la LICENCIA DEL VEHÍCULO
   b) Proveer manualmente: Placa, Marca, Modelo, Año y VIN number
   ⚠️ El VIN number es OBLIGATORIO para estimados de aseguradora
5. Fotos del daño
6. Descripción detallada de los daños

REQUERIDO PARA ASEGURADORA:
- Nombre de la aseguradora ✅
- Nombre del ajustador ✅
- Número de claim (si lo tienen)

REGLAS:
- Explica que VIN e info del seguro son necesarios para el estimado oficial
- Cuando tengas todo, muestra el RESUMEN COMPLETO

FORMATO DEL RESUMEN FINAL:
━━━━━━━━━━━━━━━━━━━━━━
📄 *ESTIMADO PARA ASEGURADORA*
Márquez Body Shop
━━━━━━━━━━━━━━━━━━━━━━
👤 *CLIENTE:*
• Nombre: [nombre]
• Email: [email]
• Celular: [celular]

🚗 *VEHÍCULO:*
• Placa: [placa]
• Marca/Modelo/Año: [info]
• VIN: [vin]

💥 *DAÑOS DESCRITOS:*
[descripción]

📸 Fotos: [recibidas/pendientes]

🏢 *INFORMACIÓN DEL SEGURO:*
• Aseguradora: [nombre]
• Ajustador: [nombre]
• Claim #: [número o "No provisto"]
━━━━━━━━━━━━━━━━━━━━━━
¿Es correcta toda esta información? ✅`;

// ============================================================
// WEBHOOK
// ============================================================
app.post('/webhook', async (req, res) => {
  try {
    const { Body, From, MediaUrl0 } = req.body;
    const customerPhone = From;
    const incomingMessage = (Body || '').trim();

    console.log(`📱 Mensaje de ${customerPhone}: ${incomingMessage}`);

    // Sesión nueva — mostrar menú
    if (!sessions[customerPhone]) {
      sessions[customerPhone] = {
        stage: 'menu',
        messages: [],
        startTime: new Date(),
        notified: false
      };
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(WELCOME_MESSAGE);
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    const session = sessions[customerPhone];

    // ── ETAPA: MENÚ ──
    if (session.stage === 'menu') {
      let confirmMessage = '';
      if (incomingMessage === '1') {
        session.stage = 'cita';
        confirmMessage = '📅 *Agendar Cita para Estimado*\n\nPerfecto, con gusto le ayudo a agendar su cita.\n\n¿Cuál es su nombre completo?';
      } else if (incomingMessage === '2') {
        session.stage = 'accidente';
        confirmMessage = '🚨 *Reporte de Accidente*\n\nLamentamos mucho lo sucedido. Lo más importante: ¿Se encuentra bien usted y todos los involucrados?';
      } else if (incomingMessage === '3') {
        session.stage = 'aseguradora';
        confirmMessage = '📄 *Estimado para Aseguradora*\n\nCon gusto le preparamos el estimado oficial.\n\n¿Cuál es su nombre completo?';
      } else {
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(`Por favor responda con *1*, *2* o *3*:\n\n${WELCOME_MESSAGE}`);
        res.type('text/xml');
        res.send(twiml.toString());
        return;
      }

      session.messages.push({
        role: 'user',
        content: `El cliente seleccionó esta opción. Inicia con: "${confirmMessage}"`
      });
      session.messages.push({
        role: 'assistant',
        content: confirmMessage
      });

      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(confirmMessage);
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    // ── ETAPA: CONVERSACIÓN ACTIVA ──
    let systemPrompt = '';
    if (session.stage === 'cita') systemPrompt = PROMPT_CITA;
    else if (session.stage === 'accidente') systemPrompt = PROMPT_ACCIDENTE;
    else if (session.stage === 'aseguradora') systemPrompt = PROMPT_ASEGURADORA;

    let userContent = incomingMessage;
    if (MediaUrl0) {
      userContent += `\n[El cliente envió una foto: ${MediaUrl0}]`;
      console.log(`📸 Foto recibida: ${MediaUrl0}`);
    }

    session.messages.push({
      role: 'user',
      content: userContent
    });

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      system: systemPrompt,
      messages: session.messages
    });

    const assistantMessage = response.content[0].text;
    session.messages.push({
      role: 'assistant',
      content: assistantMessage
    });

    // Detectar confirmación del resumen
    const isConfirmed = (
      incomingMessage.toLowerCase().includes('si') ||
      incomingMessage.toLowerCase().includes('sí') ||
      incomingMessage.toLowerCase().includes('correcto') ||
      incomingMessage.toLowerCase().includes('yes')
    ) && session.messages.some(m => m.content && m.content.includes('¿Es correcta toda esta información?'));

    if (isConfirmed && !session.notified) {
      session.notified = true;
      await notifyOwner(customerPhone, session.stage, session.messages);
    }

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(assistantMessage);
    res.type('text/xml');
    res.send(twiml.toString());

  } catch (error) {
    console.error('❌ Error en webhook:', error);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('Lo sentimos, hubo un problema técnico. Por favor llámenos directamente. 🙏\nMárquez Body Shop');
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// ============================================================
// NOTIFICACIÓN AL DUEÑO
// ============================================================
async function notifyOwner(customerPhone, stage, messages) {
  try {
    const ownerPhone = process.env.OWNER_PHONE;
    if (!ownerPhone) {
      console.warn('⚠️ OWNER_PHONE no configurado');
      return;
    }

    const stageLabels = {
      cita: '📅 NUEVA CITA',
      accidente: '🚨 ACCIDENTE',
      aseguradora: '📄 ESTIMADO ASEGURADORA'
    };

    const summaryMessage = [...messages]
      .reverse()
      .find(m => m.role === 'assistant' && (
        m.content.includes('RESUMEN') ||
        m.content.includes('REPORTE') ||
        m.content.includes('ESTIMADO PARA')
      ));

    const summaryText = summaryMessage ? summaryMessage.content : 'Ver conversación completa';

    const notification = `🔔 ${stageLabels[stage] || 'NUEVO CONTACTO'}
Márquez Body Shop

📱 Cliente: ${customerPhone}

${summaryText}

_Notificación automática del sistema_`;

    await twilioClient.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:${ownerPhone}`,
      body: notification
    });

    console.log(`✅ Notificación enviada para ${customerPhone}`);

  } catch (error) {
    console.error('❌ Error enviando notificación:', error);
  }
}

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/', (req, res) => {
  try {
    res.json({
      status: '✅ Márquez Body Shop Bot activo',
      activeSessions: Object.keys(sessions).length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error en health check:', error);
    res.status(500).json({ status: 'error', message: 'Health check failed' });
  }
});

// ============================================================
// GLOBAL ERROR HANDLERS
// ============================================================
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  // No salgas del proceso, intenta recuperarse
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // No salgas del proceso, intenta recuperarse
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  🚀 Márquez Body Shop Bot           ║`);
  console.log(`║  Puerto: ${PORT.toString().padEnd(25)}║`);
  console.log(`║  Status: ✅ Activo                   ║`);
  console.log(`║  Timestamp: ${new Date().toISOString().padEnd(20)}║`);
  console.log(`╚══════════════════════════════════════╝\n`);
}).on('error', (error) => {
  console.error('❌ Error iniciando servidor:', error);
  process.exit(1);
});

module.exports = app;
