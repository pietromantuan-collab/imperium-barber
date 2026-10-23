
// ========================================
// IMPERIUM BARBER - PAINEL ADMINISTRATIVO
// Versão de demonstração (localStorage)
// ========================================

const STORAGE_KEY = "imperium-admin-v1";
const ADMIN_EMAIL = "giangomes18@icloud.com";
const supabaseClient = window.imperiumSupabase;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const panelLogin = $("#panelLogin");
const panelLoginForm = $("#panelLoginForm");
const panelLoginMessage = $("#panelLoginMessage");
const panelApp = $("#panelApp");

const dias = [
  "Domingo", "Segunda-feira", "Terça-feira",
  "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"
];

const initialData = {
  barbeiros: [
    { id: "gian", nome: "Gian" }
  ],

  servicos: [],

  agendamentos: [],

  funcionamento: dias.map((dia, i) => ({
    dia,
    modo: i === 0 || i === 1
      ? "fechado"
      : i <= 4
        ? "chegada"
        : "agendamento",
    abertura: "09:00",
    fechamento: "20:00",
    almocoInicio: "12:00",
    almocoFim: "13:00"
  }))
};

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));

    if (saved && Array.isArray(saved.barbeiros)) {
      return saved;
    }
  } catch (error) {
    console.error("Erro ao carregar dados:", error);
  }

  return structuredClone(initialData);
}

let data = loadData();
let panelReady = false;
let lastSyncedServices = "";

const reminderTemplates = [
  {
    id: "friendly",
    label: "Lembrete amigável",
    type: "appointment",
    text: "Oi, {cliente}! Tudo bem? Passando para lembrar do seu horário na Imperium Barber no dia {data}, às {horario}. Te esperamos!"
  },
  {
    id: "confirmation",
    label: "Confirmação do horário",
    type: "appointment",
    text: "Olá, {cliente}! Seu agendamento de {servico} com {barbeiro} está confirmado para {data}, às {horario}. Se precisar falar com a gente, é só responder esta mensagem."
  },
  {
    id: "upcoming",
    label: "Seu horário está chegando",
    type: "appointment",
    text: "Oi, {cliente}! Seu horário na Imperium Barber está chegando: {data}, às {horario}, para {servico}. Até breve!"
  },
  {
    id: "direct",
    label: "Lembrete direto",
    type: "appointment",
    text: "Olá, {cliente}! Lembrete do seu atendimento na Imperium Barber: {data}, às {horario}. Esperamos você!"
  },
  {
    id: "return",
    label: "Convite para atualizar o corte",
    type: "return",
    text: "Oi, {cliente}! Faz um tempinho desde seu último agendamento na Imperium Barber ({data}). Que tal atualizar o corte? Será um prazer te receber!"
  },
  {
    id: "return-days",
    label: "Convite para renovar o visual",
    type: "return",
    text: "Olá, {cliente}! Já faz {dias} dias desde seu último agendamento. Que tal renovar o visual? Agende seu próximo corte com a Imperium Barber."
  },
  {
    id: "general",
    label: "Convite para agendar",
    type: "general",
    text: "Oi, {cliente}! Quando quiser renovar o visual, estamos à disposição. Que tal agendar seu próximo corte na Imperium Barber?"
  }
];

const REMINDER_INACTIVE_DAYS = 30;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  void syncSharedServices().catch((error) => {
    console.error("Erro ao sincronizar serviços:", error);
    const details = error && error.message ? error.message : "Erro desconhecido ao acessar o Supabase.";
    notify(`Catálogo não sincronizado: ${details}`);
  });
}

async function syncSharedServices() {
  const serialized = JSON.stringify(data.servicos);
  if (serialized === lastSyncedServices) return;

  const { error } = await supabaseClient.rpc("replace_barber_services", {
    p_services: data.servicos
  });
  if (error) throw error;

  lastSyncedServices = serialized;
}

async function loadSharedServices() {
  const { data: services, error } = await supabaseClient
    .from("barber_services")
    .select("id, nome, duracao, valor")
    .order("nome");
  if (error) throw error;

  if (!services.length && data.servicos.length) {
    await syncSharedServices();
    return;
  }

  data.servicos = services;
  lastSyncedServices = JSON.stringify(services);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function appointmentDatabaseRow(appointment) {
  return {
    id: appointment.id,
    client_user_id: null,
    cliente: appointment.cliente,
    telefone: String(appointment.telefone || "").replace(/\D/g, ""),
    servico_id: appointment.servicoId || null,
    servico_nome: appointment.servicoNome,
    valor: Number(appointment.valor) || 0,
    duracao: Number(appointment.duracao) || 30,
    barbeiro_id: appointment.barbeiroId,
    data: appointment.data,
    horario: appointment.horario,
    status: appointment.status || "agendado"
  };
}

function appointmentFromDatabase(appointment) {
  return {
    id: appointment.id,
    cliente: appointment.cliente,
    telefone: appointment.telefone.trim(),
    servicoId: appointment.servico_id,
    servicoNome: appointment.servico_nome,
    valor: Number(appointment.valor),
    duracao: Number(appointment.duracao),
    barbeiroId: appointment.barbeiro_id,
    data: appointment.data,
    horario: String(appointment.horario).slice(0, 5),
    status: appointment.status
  };
}

async function loadSharedAppointments() {
  const { data: appointments, error } = await supabaseClient
    .from("customer_appointments")
    .select("id, cliente, telefone, servico_id, servico_nome, valor, duracao, barbeiro_id, data, horario, status")
    .order("data")
    .order("horario");
  if (error) throw error;

  const sharedAppointmentIds = new Set(appointments.map((appointment) => appointment.id));
  const legacyAppointments = data.agendamentos
    .filter((appointment) =>
      !sharedAppointmentIds.has(appointment.id) &&
      /^\d{11}$/.test(String(appointment.telefone || "").replace(/\D/g, ""))
    )
    .map(appointmentDatabaseRow);

  if (legacyAppointments.length) {
    const { error: insertError } = await supabaseClient
      .from("customer_appointments")
      .insert(legacyAppointments);
    if (insertError) throw insertError;
    const { data: migratedAppointments, error: reloadError } = await supabaseClient
      .from("customer_appointments")
      .select("id, cliente, telefone, servico_id, servico_nome, valor, duracao, barbeiro_id, data, horario, status")
      .order("data")
      .order("horario");
    if (reloadError) throw reloadError;
    data.agendamentos = migratedAppointments.map(appointmentFromDatabase);
  } else {
    data.agendamentos = appointments.map(appointmentFromDatabase);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function today() {
  const date = new Date();

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function escapeHTML(value) {
  const safeValue = value == null ? "" : value;
  return String(safeValue).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function notify(message) {
  const toast = $("#toast");

  toast.textContent = message;
  toast.classList.remove("hidden");

  clearTimeout(window.toastTimer);

  window.toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 3000);
}

// ========================================
// NAVEGAÇÃO
// ========================================

function navigate(page) {
  $$(".page").forEach((section) => {
    section.classList.remove("active");
  });

  $$(".menu-item").forEach((button) => {
    button.classList.remove("active");
  });

  $("#" + page).classList.add("active");

  $(`[data-page="${page}"]`).classList.add("active");

  $("#sidebar").classList.remove("open");

  window.scrollTo({ top: 0, behavior: "smooth" });

  refresh();
}

$$(".menu-item").forEach((button) => {
  button.addEventListener("click", () => {
    navigate(button.dataset.page);
  });
});

$("#menuToggle").addEventListener("click", () => {
  $("#sidebar").classList.toggle("open");
});

$("#goAgenda").onclick = () => navigate("agenda");
$("#seeAll").onclick = () => navigate("agenda");

// ========================================
// MODAIS
// ========================================

function openModal(content) {
  $("#modalContent").innerHTML = content;
  $("#modal").classList.remove("hidden");
}

function closeModal() {
  $("#modal").classList.add("hidden");
}

function confirmDeletion(itemType, itemName, onConfirm) {
  openModal(`
    <div class="delete-confirmation">
      <span class="delete-warning-icon" aria-hidden="true">!</span>
      <span class="delete-eyebrow">Ação permanente</span>
      <h2>Excluir ${itemType}?</h2>
      <p>Este item será removido do painel. Essa ação não pode ser desfeita.</p>
      <div class="delete-item-summary">
        <small>${itemType === "serviço" ? "SERVIÇO" : "PROFISSIONAL"}</small>
        <strong>${escapeHTML(itemName)}</strong>
      </div>
      <div class="delete-confirmation-actions">
        <button class="delete-keep-button" id="keepItemButton" type="button">Manter item</button>
        <button class="delete-confirm-button" id="confirmDeleteButton" type="button">Sim, excluir</button>
      </div>
    </div>
  `);

  $("#keepItemButton").onclick = closeModal;
  $("#confirmDeleteButton").onclick = () => {
    onConfirm();
    closeModal();
  };
}

$("#closeModal").onclick = closeModal;

$("#modal").addEventListener("click", (event) => {
  if (event.target.id === "modal") {
    closeModal();
  }
});

// ========================================
// DASHBOARD
// ========================================

function appointmentsByDate(date, barberId = "todos") {
  return data.agendamentos
    .filter((appointment) => {
      const sameDate = appointment.data === date;
      const sameBarber =
        barberId === "todos" ||
        appointment.barbeiroId === barberId;

      return sameDate && sameBarber;
    })
    .reverse();
}

function renderDashboard() {
  const selectedDate = $("#dashboardDate").value;

  const appointments = appointmentsByDate(selectedDate);

  const active = appointments.filter(
    (appointment) => appointment.status !== "cancelado"
  );

  const completed = appointments.filter(
    (appointment) => appointment.status === "concluido"
  );

  const pending = appointments.filter(
    (appointment) => appointment.status === "agendado"
  );

  const revenue = completed.reduce(
    (total, appointment) => total + Number(appointment.valor || 0),
    0
  );

  $("#statTotal").textContent = active.length;
  $("#statCompleted").textContent = completed.length;
  $("#statPending").textContent = pending.length;
  $("#statRevenue").textContent = money(revenue);

  $("#dashboardAppointments").innerHTML =
    active.length
      ? active.map(appointmentHTML).join("")
      : emptyHTML("Nenhum atendimento para esta data.");

  bindAppointmentActions();
}

$("#dashboardDate").onchange = renderDashboard;

// ========================================
// AGENDA
// ========================================

function barberName(id) {
  const barber = data.barbeiros.find(
    (barber) => barber.id === id
  );
  return barber && barber.nome
    ? barber.nome
    : "Profissional não encontrado";
}

function statusLabel(status) {
  return {
    agendado: "Agendado",
    concluido: "Concluído",
    cancelado: "Cancelado"
  }[status] || status;
}

function appointmentHTML(a) {
  const canComplete = a.status === "agendado";
  const canCancel = a.status === "agendado";

  return `
    <div class="appointment">
      <div class="appointment-info">
        <div class="appointment-time">
          ${escapeHTML(a.horario)}
        </div>

        <div>
          <h4>${escapeHTML(a.cliente)}</h4>
          <p>
            ${escapeHTML(a.servicoNome)}
            · ${escapeHTML(barberName(a.barbeiroId))}
          </p>
          <p>${escapeHTML(a.telefone || "")}</p>
        </div>
      </div>

      <div class="appointment-actions">
        <span class="status ${escapeHTML(a.status)}">
          ${escapeHTML(statusLabel(a.status))}
        </span>

        ${canComplete ? `
          <button class="action-btn"
            data-complete="${escapeHTML(a.id)}">
            Concluir
          </button>` : ""}

        ${canCancel ? `
          <button class="action-btn"
            data-cancel="${escapeHTML(a.id)}">
            Cancelar
          </button>` : ""}
      </div>
    </div>
  `;
}

function emptyHTML(message) {
  return `
    <div class="empty">
      <span>✦</span>
      <p>${escapeHTML(message)}</p>
    </div>
  `;
}

function renderBarberFilter() {
  const select = $("#barberFilter");
  const current = select.value || "todos";

  select.innerHTML = `
    <option value="todos">Todos os barbeiros</option>
    ${data.barbeiros.map((barber) => `
      <option value="${escapeHTML(barber.id)}">
        ${escapeHTML(barber.nome)}
      </option>
    `).join("")}
  `;

  if ([...select.options].some(o => o.value === current)) {
    select.value = current;
  }
}

function renderAgenda() {
  const date = $("#agendaDate").value;
  const barber = $("#barberFilter").value;

  const appointments = appointmentsByDate(date, barber);

  $("#agendaAppointments").innerHTML =
    appointments.length
      ? appointments.map(appointmentHTML).join("")
      : emptyHTML("Nenhum agendamento encontrado.");

  bindAppointmentActions();
}

async function updateAppointmentStatus(id, status) {
  const appointment = data.agendamentos.find(
    (item) => item.id === id
  );

  if (!appointment || appointment.status !== "agendado") {
    notify("Este atendimento não pode ser alterado.");
    return;
  }

  const previousStatus = appointment.status;
  appointment.status = status;
  refresh();
  try {
    const { error } = await supabaseClient.rpc("update_customer_appointment_status", {
      p_id: id,
      p_status: status
    });
    if (error) throw error;
    saveData();
    notify(status === "concluido" ? "Atendimento concluído!" : "Agendamento cancelado.");
  } catch (error) {
    appointment.status = previousStatus;
    refresh();
    console.error("Erro ao atualizar o status do agendamento:", error);
    notify("Não foi possível atualizar o agendamento online. Tente novamente.");
  }
}

function bindAppointmentActions() {
  $$("[data-complete]").forEach((button) => {
    button.onclick = () => {
      updateAppointmentStatus(
        button.dataset.complete,
        "concluido"
      );
    };
  });

  $$("[data-cancel]").forEach((button) => {
    button.onclick = () => {
      if (confirm("Cancelar este agendamento?")) {
        updateAppointmentStatus(
          button.dataset.cancel,
          "cancelado"
        );
      }
    };
  });
}

$("#agendaDate").onchange = renderAgenda;
$("#barberFilter").onchange = renderAgenda;

// ========================================
// CLIENTES
// ========================================

function clientKey(appointment) {
  const phone = String(appointment.telefone || "").replace(/\D/g, "");
  return phone || String(appointment.cliente || "").trim().toLocaleLowerCase("pt-BR");
}

function renderClients() {
  const search = $("#clientSearch").value.trim().toLocaleLowerCase("pt-BR");
  const clients = new Map();

  [...data.agendamentos].reverse().forEach((appointment) => {
    const key = clientKey(appointment);
    if (!key) return;

    if (!clients.has(key)) {
      clients.set(key, {
        nome: appointment.cliente || "Cliente sem nome",
        telefone: appointment.telefone || "",
        agendamentos: [],
        ultimoAgendamento: appointment
      });
    }

    clients.get(key).agendamentos.push(appointment);
  });

  const allClients = [...clients.values()];
  const activeAppointments = data.agendamentos.filter(
    (appointment) => appointment.status === "agendado"
  ).length;
  const completedAppointments = data.agendamentos.filter(
    (appointment) => appointment.status === "concluido"
  ).length;

  $("#clientTotal").textContent = allClients.length;
  $("#clientActiveAppointments").textContent = activeAppointments;
  $("#clientCompletedAppointments").textContent = completedAppointments;

  const filteredClients = allClients.filter((client) => {
    const searchable = `${client.nome} ${client.telefone}`.toLocaleLowerCase("pt-BR");
    return searchable.includes(search);
  });

  $("#clientsList").innerHTML = filteredClients.length
    ? filteredClients.map((client) => {
      const lastAppointment = client.ultimoAgendamento;
      const completed = client.agendamentos.filter(
        (appointment) => appointment.status === "concluido"
      ).length;
      const phoneDigits = String(client.telefone).replace(/\D/g, "");

      return `
        <article class="client-row">
          <div class="client-avatar">${escapeHTML(client.nome.charAt(0).toUpperCase())}</div>
          <div class="client-info">
            <strong>${escapeHTML(client.nome)}</strong>
            <a href="tel:${escapeHTML(phoneDigits)}">${escapeHTML(client.telefone || "Telefone não informado")}</a>
          </div>
          <div class="client-history">
            <strong>${client.agendamentos.length} atendimento${client.agendamentos.length === 1 ? "" : "s"}</strong>
            <small>${completed} concluído${completed === 1 ? "" : "s"}</small>
          </div>
          <div class="client-last-visit">
            <span>ÚLTIMO AGENDAMENTO</span>
            <strong>${escapeHTML(lastAppointment.servicoNome)}</strong>
            <small>${escapeHTML(lastAppointment.data)} · ${escapeHTML(lastAppointment.horario)}</small>
          </div>
          ${phoneDigits ? `
            <a class="client-contact" href="https://wa.me/${escapeHTML(phoneDigits)}"
              target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
          ` : ""}
        </article>
      `;
    }).join("")
    : emptyHTML(search
      ? "Nenhum cliente encontrado para esta busca."
      : "Ainda não há clientes. Os contatos aparecerão aqui após o primeiro agendamento.");
}

$("#clientSearch").addEventListener("input", renderClients);

// ========================================
// LEMBRETES
// ========================================

function appointmentDateTime(appointment) {
  const dateTime = new Date(`${appointment.data}T${appointment.horario}:00`);
  return Number.isNaN(dateTime.getTime()) ? null : dateTime;
}

function formatAppointmentDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("pt-BR");
}

function brazilianWhatsAppNumber(phone) {
  const digits = String(phone || "").replace(/\D/g, "");

  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return "";
}

function reminderClients() {
  const clients = new Map();
  const now = Date.now();

  [...data.agendamentos].reverse().forEach((appointment) => {
    const digits = String(appointment.telefone || "").replace(/\D/g, "");
    if (!digits) return;

    const phone = brazilianWhatsAppNumber(digits) || digits;
    if (!clients.has(phone)) {
      clients.set(phone, {
        phone,
        nome: appointment.cliente || "Cliente sem nome",
        agendamentos: []
      });
    }

    clients.get(phone).agendamentos.push(appointment);
  });

  return [...clients.values()].map((client) => {
    const upcoming = client.agendamentos
      .filter((appointment) => {
        if (appointment.status !== "agendado") return false;
        const dateTime = appointmentDateTime(appointment);
        return dateTime && dateTime.getTime() >= now;
      })
      .sort((first, second) =>
        appointmentDateTime(first) - appointmentDateTime(second)
      )[0] || null;

    const lastAppointment = client.agendamentos
      .filter((appointment) => {
        if (appointment.status === "cancelado") return false;
        const dateTime = appointmentDateTime(appointment);
        return dateTime && dateTime.getTime() < now;
      })
      .sort((first, second) =>
        appointmentDateTime(second) - appointmentDateTime(first)
      )[0] || null;

    const lastDateTime = lastAppointment
      ? appointmentDateTime(lastAppointment)
      : null;

    return {
      ...client,
      upcoming,
      lastAppointment,
      daysSinceLastAppointment: lastDateTime
        ? Math.floor((now - lastDateTime.getTime()) / DAY_IN_MILLISECONDS)
        : null
    };
  }).sort((first, second) =>
    first.nome.localeCompare(second.nome, "pt-BR")
  );
}

function reminderMessage(client, template) {
  const appointment = template.type === "appointment"
    ? client.upcoming
    : client.lastAppointment;
  const values = {
    cliente: client.nome,
    data: appointment ? formatAppointmentDate(appointment.data) : "",
    horario: appointment && appointment.horario ? appointment.horario : "",
    servico: appointment && appointment.servicoNome ? appointment.servicoNome : "seu atendimento",
    barbeiro: appointment ? barberName(appointment.barbeiroId) : "",
    dias: client.daysSinceLastAppointment != null ? client.daysSinceLastAppointment : ""
  };

  return template.text.replace(/\{(cliente|data|horario|servico|barbeiro|dias)\}/g,
    (_, key) => values[key]
  );
}

function updateReminderTemplates(client) {
  const select = $("#reminderTemplate");
  const selectedTemplate = select.value;
  const templates = reminderTemplates.filter((template) =>
    template.type === "general" ||
    (template.type === "appointment" && client && client.upcoming) ||
    (template.type === "return" &&
      (!client || !client.upcoming) &&
      client && client.daysSinceLastAppointment >= REMINDER_INACTIVE_DAYS)
  );

  select.innerHTML = templates.length
    ? templates.map((template) => `
        <option value="${template.id}">${escapeHTML(template.label)}</option>
      `).join("")
    : '<option value="">Nenhuma mensagem disponível</option>';

  if (templates.some((template) => template.id === selectedTemplate)) {
    select.value = selectedTemplate;
  }
}

function updateReminderPreview() {
  const client = reminderClients().find(
    (item) => item.phone === $("#reminderClient").value
  );
  const template = reminderTemplates.find(
    (item) => item.id === $("#reminderTemplate").value
  );
  const customMessage = $("#reminderCustomMessage");
  const preview = $("#reminderMessage");
  const contactStatus = $("#reminderContactStatus");
  const sendLink = $("#sendReminder");

  if (!client || !template) {
    preview.textContent = "Selecione um cliente para visualizar a mensagem.";
    contactStatus.textContent =
      `O convite para atualizar o corte aparece após ${REMINDER_INACTIVE_DAYS} dias sem agendamento.`;
    customMessage.value = "";
    customMessage.disabled = true;
    sendLink.href = "#";
    sendLink.classList.add("is-disabled");
    sendLink.setAttribute("aria-disabled", "true");
    return;
  }

  customMessage.disabled = false;
  const message = customMessage.value.trim();

  preview.textContent = message || "Digite uma mensagem para visualizar a prévia.";

  if (!message) {
    contactStatus.textContent = "Escreva uma mensagem antes de abrir o WhatsApp.";
    sendLink.href = "#";
    sendLink.classList.add("is-disabled");
    sendLink.setAttribute("aria-disabled", "true");
    return;
  }

  if (!/^(55\d{10,11})$/.test(client.phone)) {
    contactStatus.textContent =
      "Número inválido para WhatsApp. Confira o cadastro do cliente antes de enviar.";
    sendLink.href = "#";
    sendLink.classList.add("is-disabled");
    sendLink.setAttribute("aria-disabled", "true");
    return;
  }

  contactStatus.textContent =
    `WhatsApp: +${client.phone} · Confira a mensagem antes de enviar.`;
  sendLink.href =
    `https://wa.me/${client.phone}?text=${encodeURIComponent(message)}`;
  sendLink.classList.remove("is-disabled");
  sendLink.setAttribute("aria-disabled", "false");
}

function populateReminderDraft() {
  const client = reminderClients().find(
    (item) => item.phone === $("#reminderClient").value
  );
  const template = reminderTemplates.find(
    (item) => item.id === $("#reminderTemplate").value
  );

  $("#reminderCustomMessage").value =
    client && template ? reminderMessage(client, template) : "";
  updateReminderPreview();
}

function renderReminders() {
  const select = $("#reminderClient");
  const selectedPhone = select.value;
  const clients = reminderClients();
  const withUpcoming = clients.filter((client) => client.upcoming).length;
  const inactive = clients.filter((client) =>
    !client.upcoming &&
    client.daysSinceLastAppointment >= REMINDER_INACTIVE_DAYS
  ).length;

  $("#reminderAppointmentsCount").textContent =
    `${clients.length} cliente${clients.length === 1 ? "" : "s"} único${clients.length === 1 ? "" : "s"} com telefone · ` +
    `${withUpcoming} com horário futuro · ${inactive} sem agendar há ${REMINDER_INACTIVE_DAYS} dias ou mais.`;

  select.innerHTML = `
    <option value="">Selecione um cliente</option>
    ${clients.map((client) => `
      <option value="${escapeHTML(client.phone)}">
        ${escapeHTML(client.nome)} · +${escapeHTML(client.phone)}
      </option>
    `).join("")}
  `;

  if (clients.some((client) => client.phone === selectedPhone)) {
    select.value = selectedPhone;
  }

  const client = clients.find((item) => item.phone === select.value);
  updateReminderTemplates(client);
  updateReminderPreview();
}

$("#reminderClient").addEventListener("change", () => {
  const client = reminderClients().find(
    (item) => item.phone === $("#reminderClient").value
  );
  updateReminderTemplates(client);
  populateReminderDraft();
});
$("#reminderTemplate").addEventListener("change", populateReminderDraft);
$("#reminderCustomMessage").addEventListener("input", updateReminderPreview);
$("#sendReminder").addEventListener("click", (event) => {
  if ($("#sendReminder").getAttribute("aria-disabled") === "true") {
    event.preventDefault();
    notify("Selecione um cliente com número de WhatsApp válido.");
  }
});

// ========================================
// SERVIÇOS
// ========================================

function renderServices() {
  $("#servicesList").innerHTML =
    data.servicos.length
      ? data.servicos.map((service) => `
          <div class="data-row">
            <div>
              <strong>${escapeHTML(service.nome)}</strong>
              <small>
                ${escapeHTML(service.duracao)} minutos
                · ${money(service.valor)}
              </small>
            </div>

            <div>
              <button class="action-btn"
                data-edit-service="${escapeHTML(service.id)}">
                Editar
              </button>

              <button class="action-btn delete-trigger"
                data-delete-service="${escapeHTML(service.id)}">
                Excluir
              </button>
            </div>
          </div>
        `).join("")
      : emptyHTML("Nenhum serviço cadastrado.");

  $$("[data-edit-service]").forEach(button => {
    button.onclick = () =>
      serviceModal(button.dataset.editService);
  });

  $$("[data-delete-service]").forEach(button => {
    button.onclick = () =>
      deleteService(button.dataset.deleteService);
  });
}

function serviceModal(id = null) {
  const service = data.servicos.find(s => s.id === id);

  openModal(`
    <h2>${service ? "Editar serviço" : "Novo serviço"}</h2>
    <p>Defina os dados do serviço.</p>

    <form id="serviceForm">
      <div class="form-group">
        <label>Nome do serviço</label>
        <input name="nome" required
          value="${escapeHTML(service && service.nome ? service.nome : "")}"
          placeholder="Ex.: Corte masculino">
      </div>

      <div class="form-group">
        <label>Preço (R$)</label>
        <input name="valor" type="number" min="0"
          step="0.01" required
          value="${service && service.valor != null ? service.valor : ""}"
          placeholder="Ex.: 45.00">
      </div>

      <div class="form-group">
        <label>Duração (minutos)</label>
        <input name="duracao" type="number"
          min="5" max="480" required
          value="${service && service.duracao != null ? service.duracao : 40}">
      </div>

      <button class="btn-gold" type="submit">
        Salvar serviço
      </button>
    </form>
  `);

  $("#serviceForm").onsubmit = (event) => {
    event.preventDefault();

    const form = new FormData(event.target);

    const values = {
      nome: String(form.get("nome")).trim(),
      valor: Number(form.get("valor")),
      duracao: Number(form.get("duracao"))
    };

    if (!values.nome || values.valor < 0 || values.duracao < 5) {
      notify("Confira os dados do serviço.");
      return;
    }

    if (service) {
      Object.assign(service, values);
    } else {
      data.servicos.push({
        id: crypto.randomUUID(),
        ...values
      });
    }

    saveData();
    closeModal();
    renderServices();
    notify("Serviço salvo com sucesso!");
  };
}

function deleteService(id) {
  const service = data.servicos.find(item => item.id === id);
  if (!service) return;

  confirmDeletion("serviço", service.nome, () => {
    data.servicos = data.servicos.filter(item => item.id !== id);
    saveData();
    renderServices();
    notify("Serviço excluído.");
  });
}

$("#addService").onclick = () => serviceModal();

// ========================================
// BARBEIROS
// ========================================

function renderBarbers() {
  $("#barbersList").innerHTML = data.barbeiros.map(barber => `
    <div class="barber-card">
      <div class="barber-avatar">
        ${escapeHTML(barber.nome.charAt(0).toUpperCase())}
      </div>

      <h3>${escapeHTML(barber.nome)}</h3>
      <p>Profissional Imperium Barber</p>

      <button class="action-btn"
        data-edit-barber="${escapeHTML(barber.id)}">
        Editar
      </button>

      <button class="action-btn delete-trigger"
        data-delete-barber="${escapeHTML(barber.id)}">
        Excluir
      </button>
    </div>
  `).join("");

  $$("[data-edit-barber]").forEach(button => {
    button.onclick = () =>
      barberModal(button.dataset.editBarber);
  });

  $$("[data-delete-barber]").forEach(button => {
    button.onclick = () =>
      deleteBarber(button.dataset.deleteBarber);
  });
}

function barberModal(id = null) {
  const barber = data.barbeiros.find(b => b.id === id);

  openModal(`
    <h2>${barber ? "Editar barbeiro" : "Novo barbeiro"}</h2>
    <p>Cadastre ou atualize um profissional.</p>

    <form id="barberForm">
      <div class="form-group">
        <label>Nome do profissional</label>
        <input name="nome" required
          value="${escapeHTML(barber && barber.nome ? barber.nome : "")}"
          placeholder="Nome do barbeiro">
      </div>

      <button class="btn-gold" type="submit">
        Salvar profissional
      </button>
    </form>
  `);

  $("#barberForm").onsubmit = (event) => {
    event.preventDefault();

    const nome = String(
      new FormData(event.target).get("nome")
    ).trim();

    if (!nome) return;

    if (barber) {
      barber.nome = nome;
    } else {
      data.barbeiros.push({
        id: crypto.randomUUID(),
        nome
      });
    }

    saveData();
    closeModal();
    refresh();
    notify("Profissional salvo!");
  };
}

function deleteBarber(id) {
  const barber = data.barbeiros.find(item => item.id === id);
  if (!barber) return;

  if (data.barbeiros.length <= 1) {
    notify("É necessário manter pelo menos um barbeiro.");
    return;
  }

  const hasAppointments = data.agendamentos.some(a =>
    a.barbeiroId === id && a.status === "agendado"
  );

  if (hasAppointments) {
    notify("Este barbeiro possui agendamentos pendentes.");
    return;
  }

  confirmDeletion("profissional", barber.nome, () => {
    data.barbeiros = data.barbeiros.filter(item => item.id !== id);
    saveData();
    refresh();
    notify("Profissional removido.");
  });
}

$("#addBarber").onclick = () => barberModal();

// ========================================
// FUNCIONAMENTO
// ========================================

function renderHours() {
  $("#daysContainer").innerHTML =
    data.funcionamento.map((config, index) => `
      <div class="day-card">
        <div class="day-title">${escapeHTML(config.dia)}</div>

        <div class="day-fields">
          <label>
            Atendimento
            <select name="modo-${index}">
              <option value="fechado"
                ${config.modo === "fechado" ? "selected" : ""}>
                Fechado
              </option>

              <option value="chegada"
                ${config.modo === "chegada" ? "selected" : ""}>
                Ordem de chegada
              </option>

              <option value="agendamento"
                ${config.modo === "agendamento" ? "selected" : ""}>
                Horário marcado
              </option>
            </select>
          </label>

          <label>
            Abertura
            <input type="time" name="abertura-${index}"
              value="${config.abertura}">
          </label>

          <label>
            Fechamento
            <input type="time" name="fechamento-${index}"
              value="${config.fechamento}">
          </label>

          <label>
            Início almoço
            <input type="time" name="almocoInicio-${index}"
              value="${config.almocoInicio}">
          </label>

          <label>
            Fim almoço
            <input type="time" name="almocoFim-${index}"
              value="${config.almocoFim}">
          </label>
        </div>
      </div>
    `).join("");
}

$("#hoursForm").onsubmit = (event) => {
  event.preventDefault();

  const form = new FormData(event.target);

  const updated = data.funcionamento.map((day, index) => ({
    ...day,
    modo: form.get(`modo-${index}`),
    abertura: form.get(`abertura-${index}`),
    fechamento: form.get(`fechamento-${index}`),
    almocoInicio: form.get(`almocoInicio-${index}`),
    almocoFim: form.get(`almocoFim-${index}`)
  }));

  const invalid = updated.some(day => {
    if (day.modo === "fechado") return false;

    return (
      day.abertura >= day.fechamento ||
      day.almocoInicio >= day.almocoFim ||
      day.almocoInicio < day.abertura ||
      day.almocoFim > day.fechamento
    );
  });

  if (invalid) {
    notify("Confira os horários de funcionamento e almoço.");
    return;
  }

  data.funcionamento = updated;

  saveData();
  renderHours();
  notify("Configurações salvas!");
};

// ========================================
// ATUALIZAÇÃO GERAL
// ========================================

function refresh() {
  renderBarberFilter();
  renderDashboard();
  renderAgenda();
  renderClients();
  renderReminders();
  renderServices();
  renderBarbers();
  renderHours();
}

async function enterPanel(user) {
  if (!user || !user.email || user.email.toLowerCase() !== ADMIN_EMAIL) {
    panelLoginMessage.textContent = "Esta conta não está autorizada para acessar o painel.";
    await supabaseClient.auth.signOut();
    return;
  }

  panelLogin.hidden = true;
  panelApp.hidden = false;
  if (panelReady) return;
  panelReady = true;

  data = loadData();
  try {
    await loadSharedServices();
  } catch (error) {
    console.error("Erro ao carregar o catálogo compartilhado:", error);
    notify("Não foi possível carregar o catálogo online. Confira a configuração do Supabase.");
  }
  try {
    await loadSharedAppointments();
  } catch (error) {
    console.error("Erro ao carregar os agendamentos compartilhados:", error);
    notify("Não foi possível carregar os agendamentos online. Execute a configuração atualizada do Supabase.");
  }

  $("#dashboardDate").value = today();
  $("#agendaDate").value = today();
  refresh();
}

panelLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("#panelLoginEmail").value.trim().toLowerCase();
  const password = $("#panelLoginPassword").value;
  const submitButton = panelLoginForm.querySelector("button[type='submit']");

  if (email !== ADMIN_EMAIL) {
    panelLoginMessage.textContent = "Use o e-mail autorizado para acessar o painel.";
    return;
  }

  submitButton.disabled = true;
  panelLoginMessage.textContent = "Verificando acesso...";
  const { data: authData, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  submitButton.disabled = false;

  if (error) {
    panelLoginMessage.textContent = "Não foi possível entrar. Confira o e-mail e a senha.";
    return;
  }

  $("#panelLoginPassword").value = "";
  await enterPanel(authData.user);
});

$("#logoutButton").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
});

supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (session && session.user) {
    void enterPanel(session.user);
    return;
  }

  panelReady = false;
  panelApp.hidden = true;
  panelLogin.hidden = false;
});

// ========================================
// INICIALIZAÇÃO
// ========================================

$("#panelLoginEmail").value = ADMIN_EMAIL;
void supabaseClient.auth.getSession().then(({ data: sessionData, error }) => {
  if (error) {
    panelLoginMessage.textContent = "Não foi possível verificar a sessão. Atualize a página.";
    return;
  }
  if (sessionData.session && sessionData.session.user) void enterPanel(sessionData.session.user);
});

window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) {
    data = loadData();
    refresh();
  }
});
