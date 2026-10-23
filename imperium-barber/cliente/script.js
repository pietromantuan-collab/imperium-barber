const STORAGE_KEY = "imperium-admin-v1";
const BARBERSHOP_WHATSAPP = "5515997876114";
const supabaseClient = window.imperiumSupabase;
const DAY_NAMES = [
  "Domingo", "Segunda-feira", "Terça-feira",
  "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"
];
const INITIAL_DATA = {
  barbeiros: [{ id: "gian", nome: "Gian" }],
  servicos: [],
  agendamentos: [],
  funcionamento: DAY_NAMES.map((dia, index) => ({
    dia,
    modo: index === 0 || index === 1
      ? "fechado"
      : index <= 4
        ? "chegada"
        : "agendamento",
    abertura: "09:00",
    fechamento: "20:00",
    almocoInicio: "12:00",
    almocoFim: "13:00"
  }))
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const form = $("#customerForm");
const serviceList = $("#servicesList");
const barberSelect = $("#barberSelect");
const dateInput = $("#dateInput");
const timeSlots = $("#timeSlots");
const continueButton = $("#continueButton");
const formMessage = $("#formMessage");
const bookingBar = $("#bookingBar");
const cancelDialog = $("#cancelDialog");
const authScreen = $("#authScreen");
const authMessage = $("#authMessage");

let data;
let loadError = false;
let activeStep = 1;
let highestStep = 1;
let activeView = "booking";
let bookingConfirmed = false;
let selectedServiceId = "";
let selectedBarberId = "";
let selectedTime = "";
let pendingCancellationId = "";
let appointmentLookupPhone = "";
let authView = "login";
const authUrlParams = new URLSearchParams(
  `${window.location.search.slice(1)}&${window.location.hash.slice(1)}`
);
let recoveryRequested = authUrlParams.get("type") === "recovery";
let clientDataReady = false;
let customerUser = null;
let bookingSubmitting = false;

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
  return String(safeValue).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function isValidData(value) {
  return value &&
    Array.isArray(value.barbeiros) &&
    Array.isArray(value.servicos) &&
    Array.isArray(value.agendamentos) &&
    Array.isArray(value.funcionamento);
}

function loadData() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return structuredClone(INITIAL_DATA);

  const parsed = JSON.parse(stored);
  if (!isValidData(parsed)) {
    throw new Error("Os dados do painel estão incompletos ou inválidos.");
  }
  return parsed;
}

async function loadSharedServices() {
  const { data: services, error } = await supabaseClient
    .from("barber_services")
    .select("id, nome, duracao, valor")
    .eq("ativo", true)
    .order("nome");

  if (error) throw error;
  data.servicos = services || [];
}

function mapAppointmentFromDatabase(appointment) {
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
  data.agendamentos = (appointments || []).map(mapAppointmentFromDatabase);
}

async function refreshSharedAppointments() {
  await loadSharedAppointments();
  persistLocalData();
  if (activeView === "appointments") renderClientAppointments();
}

function persistLocalData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error("Erro ao atualizar o cache local de agendamentos:", error);
  }
}

function selectedService() {
  return data.servicos.find((service) => service.id === selectedServiceId);
}

function selectedBarber() {
  return data.barbeiros.find((barber) => barber.id === selectedBarberId);
}

function formatDate(date) {
  return date
    ? new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR")
    : "";
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function isValidPhone(phone) {
  return /^\d{11}$/.test(normalizePhone(phone));
}

function describeAuthError(error, fallback) {
  const details = error instanceof Error
    ? error.message
    : String(error || "");
  const code = error && error.code ? ` (${error.code})` : "";
  const status = error && error.status ? ` [HTTP ${error.status}]` : "";
  return details
    ? `${fallback} ${details}${code}${status}`
    : fallback;
}

function setAuthView(view, message = "") {
  authView = view;
  ["login", "signup", "forgot", "reset"].forEach((name) => {
    $(`#${name}Form`).hidden = name !== view;
  });
  const titles = {
    login: ["Entre para continuar", "Acesse sua conta para agendar e acompanhar seus horários."],
    signup: ["Crie sua conta", "Cadastre seus dados para começar a usar a agenda Imperium."],
    forgot: ["Recuperar senha", "Enviaremos um link para o e-mail cadastrado."],
    reset: ["Defina uma nova senha", "Escolha uma senha nova para acessar sua conta."]
  };
  $("#authTitle").textContent = titles[view][0];
  $("#authDescription").textContent = titles[view][1];
  authMessage.textContent = message;
}

function showAuth(message = "") {
  authScreen.hidden = false;
  $("#clientProfile").hidden = true;
  $("#clientApp").hidden = true;
  $("#clientFooter").hidden = true;
  setAuthView(authView, message);
}

function enterCustomerApp(user) {
  const metadata = user.user_metadata || {};
  const phone = normalizePhone(metadata.telefone);
  const name = String(metadata.full_name || "").trim();

  authScreen.hidden = true;
  $("#clientProfile").hidden = false;
  $("#clientApp").hidden = false;
  $("#clientFooter").hidden = false;

  form.elements.cliente.defaultValue = name;
  form.elements.cliente.value = name;
  const phoneField = form.elements.telefone;
  phoneField.defaultValue = isValidPhone(phone) ? phone : "";
  if (isValidPhone(phone)) {
    phoneField.value = phone;
    phoneField.readOnly = true;
    phoneField.setAttribute("aria-label", "Telefone cadastrado na sua conta");
  } else {
    phoneField.readOnly = false;
    phoneField.removeAttribute("aria-label");
  }

  appointmentLookupPhone = isValidPhone(phone) ? phone : "";
  $("#accountPhoneDisplay").textContent = appointmentLookupPhone || "Não cadastrado";
  refresh();
  setView(activeView);
  setStep(activeStep);
}

function renderServices() {
  const services = data.servicos.filter((service) => service.nome);

  if (!services.length) {
    serviceList.innerHTML = `
      <div class="empty-state">
        <strong>Nenhum serviço disponível no momento.</strong>
        A equipe da Imperium Barber ainda está preparando o catálogo.
      </div>
    `;
    selectedServiceId = "";
    return;
  }

  if (!services.some((service) => service.id === selectedServiceId)) {
    selectedServiceId = "";
  }

  serviceList.innerHTML = services.map((service) => {
    const isSelected = service.id === selectedServiceId;
    return `
      <button class="service-option${isSelected ? " selected" : ""}" type="button"
        data-service-id="${escapeHTML(service.id)}" aria-pressed="${isSelected}">
        <span class="service-choice" aria-hidden="true">${isSelected ? "✓" : ""}</span>
        <span class="service-description">
          <strong>${escapeHTML(service.nome)}</strong>
          <small>${escapeHTML(service.duracao)} min</small>
        </span>
        <span class="service-price">${money(service.valor)}</span>
      </button>
    `;
  }).join("");

  serviceList.querySelectorAll("[data-service-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedServiceId = button.dataset.serviceId;
      renderServices();
      updateBookingSummary();
      updateContinueButton();
      if (activeStep >= 2) renderTimeSlots();
    });
  });
}

function renderBarbers() {
  const previous = selectedBarberId;
  barberSelect.innerHTML = `
    <option value="">Selecione um profissional</option>
    ${data.barbeiros.map((barber) => `
      <option value="${escapeHTML(barber.id)}">${escapeHTML(barber.nome)}</option>
    `).join("")}
  `;

  if (data.barbeiros.some((barber) => barber.id === previous)) {
    barberSelect.value = previous;
  } else {
    selectedBarberId = "";
  }
}

function minutes(time) {
  const [hours, mins] = String(time).split(":").map(Number);
  return hours * 60 + mins;
}

function timeString(value) {
  const hours = String(Math.floor(value / 60)).padStart(2, "0");
  const mins = String(value % 60).padStart(2, "0");
  return `${hours}:${mins}`;
}

function scheduleForDate(date) {
  if (!date) return null;
  const weekday = new Date(`${date}T12:00:00`).getDay();
  return data.funcionamento[weekday] || null;
}

function appointmentDuration(appointment) {
  if (Number(appointment.duracao) > 0) return Number(appointment.duracao);
  const service = data.servicos.find((item) => item.nome === appointment.servicoNome);
  return Number(service && service.duracao) || 30;
}

function timeIsAvailable(start, duration, config, appointments) {
  const end = start + duration;
  const opening = minutes(config.abertura);
  const closing = minutes(config.fechamento);

  if (start < opening || end > closing) return false;

  const lunchStart = minutes(config.almocoInicio);
  const lunchEnd = minutes(config.almocoFim);
  if (lunchEnd > lunchStart && start < lunchEnd && end > lunchStart) return false;

  return !appointments.some((appointment) => {
    const appointmentStart = minutes(appointment.horario);
    const appointmentEnd = appointmentStart + appointmentDuration(appointment);
    return start < appointmentEnd && end > appointmentStart;
  });
}

function renderTimeSlots() {
  selectedTime = "";
  const service = selectedService();
  const config = scheduleForDate(dateInput.value);
  renderScheduleNotice(config);

  if (!service || !selectedBarberId || !dateInput.value) {
    timeSlots.innerHTML = '<p class="field-hint">Selecione um profissional e uma data.</p>';
    updateBookingSummary();
    updateContinueButton();
    return;
  }

  if (dateInput.value < today()) {
    timeSlots.innerHTML = '<p class="field-hint">Escolha uma data de hoje em diante.</p>';
    updateBookingSummary();
    updateContinueButton();
    return;
  }

  if (!config || config.modo === "fechado") {
    timeSlots.innerHTML = '<p class="field-hint">A barbearia estará fechada nesta data. Escolha outro dia.</p>';
    updateBookingSummary();
    updateContinueButton();
    return;
  }

  if (config.modo !== "agendamento") {
    timeSlots.innerHTML = '<p class="field-hint">Não há horários para reservar neste dia. Você pode vir direto à barbearia durante o expediente.</p>';
    updateBookingSummary();
    updateContinueButton();
    return;
  }

  const appointments = data.agendamentos.filter((appointment) =>
    appointment.data === dateInput.value &&
    appointment.barbeiroId === selectedBarberId &&
    appointment.status !== "cancelado"
  );
  const firstSlot = Math.ceil(minutes(config.abertura) / 30) * 30;
  const duration = Math.max(5, Number(service.duracao) || 30);
  const now = new Date();
  const isToday = dateInput.value === today();
  const availableTimes = [];

  for (let start = firstSlot; start + duration <= minutes(config.fechamento); start += 30) {
    if (isToday && start <= now.getHours() * 60 + now.getMinutes()) continue;
    if (timeIsAvailable(start, duration, config, appointments)) {
      availableTimes.push(timeString(start));
    }
  }

  if (!availableTimes.length) {
    timeSlots.innerHTML = '<p class="field-hint">Não há horários disponíveis nesta data. Tente outro dia.</p>';
    updateBookingSummary();
    updateContinueButton();
    return;
  }

  timeSlots.innerHTML = availableTimes.map((time) => `
    <button class="time-slot" type="button" data-time="${time}" aria-pressed="false">${time}</button>
  `).join("");

  timeSlots.querySelectorAll("[data-time]").forEach((button) => {
    button.addEventListener("click", () => {
      timeSlots.querySelectorAll(".time-slot").forEach((slot) => {
        slot.classList.remove("selected");
        slot.setAttribute("aria-pressed", "false");
      });
      button.classList.add("selected");
      button.setAttribute("aria-pressed", "true");
      selectedTime = button.dataset.time;
      updateBookingSummary();
      updateContinueButton();
    });
  });

  updateBookingSummary();
  updateContinueButton();
}

function renderScheduleNotice(config) {
  const notice = $("#scheduleNotice");
  if (!dateInput.value || !config) {
    notice.hidden = true;
    notice.innerHTML = "";
    return;
  }

  if (config.modo === "chegada") {
    notice.className = "schedule-notice arrival-notice";
    notice.innerHTML = `
      <span class="notice-icon" aria-hidden="true">!</span>
      <div>
        <strong>Este dia é por ordem de chegada</strong>
        <p>Não fazemos agendamentos para esta data. Venha direto à barbearia entre <strong>${escapeHTML(config.abertura)}</strong> e <strong>${escapeHTML(config.fechamento)}</strong>; atenderemos você por ordem de chegada.</p>
        <span class="notice-tip">Para reservar um horário, escolha outro dia com agenda aberta.</span>
      </div>
    `;
    notice.hidden = false;
    return;
  }

  if (config.modo === "fechado") {
    notice.className = "schedule-notice closed-notice";
    notice.innerHTML = `
      <span class="notice-icon" aria-hidden="true">×</span>
      <div>
        <strong>A barbearia estará fechada nesta data</strong>
        <p>Escolha outro dia para continuar com seu agendamento.</p>
      </div>
    `;
    notice.hidden = false;
    return;
  }

  notice.hidden = true;
  notice.innerHTML = "";
}

function updateBookingSummary() {
  const service = selectedService();
  const duration = service ? Number(service.duracao) || 0 : 0;
  const price = service ? Number(service.valor) || 0 : 0;
  const totalDuration = $("#totalDuration");
  const totalPrice = $("#totalPrice");
  totalDuration.innerHTML = `${duration} min <small>de atendimento</small>`;
  totalPrice.textContent = money(price);

  const summary = $("#confirmationSummary");
  if (summary) {
    const details = [
      service ? service.nome : "",
      selectedBarber() && selectedBarber().nome ? selectedBarber().nome : "",
      formatDate(dateInput.value),
      selectedTime
    ].filter(Boolean);
    summary.innerHTML = `
      <span>RESUMO DO AGENDAMENTO</span>
      <strong>${escapeHTML(details.join(" · ") || "Selecione serviço, profissional e horário.")}</strong>
      <small>${duration} min · ${money(price)}</small>
    `;
  }
}

function updateContinueButton() {
  if (loadError) {
    continueButton.disabled = true;
    return;
  }

  if (activeStep === 1) {
    continueButton.disabled = !selectedService();
    continueButton.innerHTML = 'Escolher horário <span aria-hidden="true">→</span>';
  } else if (activeStep === 2) {
    continueButton.disabled = !selectedService() || !selectedBarberId || !dateInput.value || !selectedTime;
    continueButton.innerHTML = 'Continuar <span aria-hidden="true">→</span>';
  } else {
    const name = String(new FormData(form).get("cliente") || "").trim();
    const phone = String(new FormData(form).get("telefone") || "");
    continueButton.disabled = !name || !isValidPhone(phone);
    continueButton.innerHTML = 'Confirmar agendamento <span aria-hidden="true">✓</span>';
  }
}

function setStep(step) {
  activeStep = step;
  $$(".booking-step").forEach((panel) => {
    const isActive = Number(panel.dataset.step) === step;
    panel.hidden = !isActive;
    panel.classList.toggle("active", isActive);
  });
  $$(".step[data-step-link]").forEach((button) => {
    const buttonStep = Number(button.dataset.stepLink);
    button.classList.toggle("active", buttonStep === step);
    button.classList.toggle("completed", buttonStep < step);
    button.toggleAttribute("aria-current", buttonStep === step);
    if (buttonStep === step) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
    button.disabled = buttonStep > highestStep || loadError;
  });
  bookingBar.hidden = bookingConfirmed;
  $("#bookingFeedback").hidden = true;
  formMessage.textContent = "";
  updateBookingSummary();
  updateContinueButton();
  if (step === 2) renderTimeSlots();
  if (step === 3) {
    form.elements.cliente.focus({ preventScroll: true });
  }
  $("#bookingView").scrollIntoView({ behavior: "smooth", block: "start" });
}

function setView(view) {
  activeView = view;
  const views = {
    booking: ["bookingView", "bookingTab"],
    gallery: ["galleryView", "galleryTab"],
    appointments: ["appointmentsView", "appointmentsTab"]
  };

  Object.entries(views).forEach(([viewName, [panelId, tabId]]) => {
    const isActive = viewName === view;
    $(`#${panelId}`).hidden = !isActive;
    $(`#${tabId}`).classList.toggle("active", isActive);
    $(`#${tabId}`).setAttribute("aria-selected", String(isActive));
  });
  bookingBar.hidden = view !== "booking" || bookingConfirmed;
  if (view === "appointments") {
    renderClientAppointments();
    void refreshSharedAppointments().catch((error) => {
      $("#lookupMessage").textContent = "Não foi possível carregar seus agendamentos. Tente novamente.";
      console.error("Erro ao consultar os agendamentos do cliente:", error);
    });
  }
}

function renderClientAppointments() {
  const container = $("#clientAppointments");
  const lookupMessage = $("#lookupMessage");
  const matches = [...data.agendamentos].reverse();

  if (!matches.length) {
    container.innerHTML = "";
    lookupMessage.textContent = "Ainda não há agendamentos associados à sua conta.";
    return;
  }

  lookupMessage.textContent = `${matches.length} agendamento${matches.length === 1 ? "" : "s"} encontrado${matches.length === 1 ? "" : "s"}.`;
  container.innerHTML = matches.map((appointment) => {
    const barber = data.barbeiros.find((item) => item.id === appointment.barbeiroId);
    const status = appointment.status || "agendado";
    const statusLabel = {
      agendado: "Agendado",
      concluido: "Concluído",
      cancelado: "Cancelado"
    }[status] || status;
    const canCancel = status === "agendado";
    return `
      <article class="client-appointment">
        <div class="client-appointment-heading">
          <span class="appointment-date">${escapeHTML(formatDate(appointment.data))} · ${escapeHTML(appointment.horario)}</span>
          <span class="appointment-status ${escapeHTML(status)}">${escapeHTML(statusLabel)}</span>
        </div>
        <h3>${escapeHTML(appointment.servicoNome)}</h3>
        <p>${escapeHTML((barber && barber.nome) || "Profissional Imperium")} · ${money(appointment.valor)}</p>
        ${canCancel ? `
          <button class="cancel-appointment-button" type="button"
            data-cancel-appointment="${escapeHTML(appointment.id)}">
            <span aria-hidden="true">×</span> Cancelar horário
          </button>
        ` : ""}
      </article>
    `;
  }).join("");

  container.querySelectorAll("[data-cancel-appointment]").forEach((button) => {
    button.addEventListener("click", () => openCancellationDialog(button.dataset.cancelAppointment));
  });
}

function openCancellationDialog(appointmentId) {
  const appointment = data.agendamentos.find((item) =>
    item.id === appointmentId
  );

  if (!appointment || appointment.status !== "agendado") {
    renderClientAppointments();
    return;
  }

  const barber = data.barbeiros.find((item) => item.id === appointment.barbeiroId);
  pendingCancellationId = appointmentId;
  $("#cancelServiceName").textContent = appointment.servicoNome;
  $("#cancelAppointmentDate").textContent = `${formatDate(appointment.data)} às ${appointment.horario}`;
  $("#cancelBarberName").textContent = (barber && barber.nome) || "Profissional Imperium";
  cancelDialog.showModal();
}

$("#keepAppointmentButton").addEventListener("click", () => cancelDialog.close());
$("#confirmCancellationButton").addEventListener("click", () => {
  const appointmentId = pendingCancellationId;
  cancelDialog.close();
  pendingCancellationId = "";
  cancelClientAppointment(appointmentId);
});

cancelDialog.addEventListener("close", () => {
  pendingCancellationId = "";
});

async function cancelClientAppointment(appointmentId) {
  const appointment = data.agendamentos.find((item) =>
    item.id === appointmentId
  );
  if (!appointment || appointment.status !== "agendado") {
    renderClientAppointments();
    return;
  }

  try {
    const { error } = await supabaseClient.rpc("update_customer_appointment_status", {
      p_id: appointmentId,
      p_status: "cancelado"
    });
    if (error) throw error;
    appointment.status = "cancelado";
    persistLocalData();
    renderClientAppointments();
    $("#lookupMessage").textContent = "Agendamento cancelado. O horário foi atualizado.";
  } catch (error) {
    $("#lookupMessage").textContent = "Não foi possível cancelar agora. Tente novamente.";
    console.error("Erro ao cancelar agendamento:", error);
  }
}

async function confirmBooking() {
  if (!form.reportValidity()) return;
  if (bookingSubmitting) return;

  const service = selectedService();
  const barber = selectedBarber();
  const time = selectedTime;
  const config = scheduleForDate(dateInput.value);
  const appointments = data.agendamentos.filter((appointment) =>
    appointment.data === dateInput.value &&
    appointment.barbeiroId === selectedBarberId &&
    appointment.status !== "cancelado"
  );

  if (!service || !barber || !config || !time ||
      dateInput.value < today() ||
      config.modo !== "agendamento" ||
      !timeIsAvailable(minutes(time), Number(service.duracao) || 30, config, appointments)) {
    selectedTime = "";
    highestStep = Math.max(highestStep, 2);
    setStep(2);
    $("#bookingFeedback").textContent = "Esse horário não está mais disponível. Escolha outro horário para continuar.";
    $("#bookingFeedback").hidden = false;
    renderTimeSlots();
    return;
  }

  const formData = new FormData(form);
  const appointment = {
    id: crypto.randomUUID(),
    cliente: String(formData.get("cliente")).trim(),
    telefone: normalizePhone(formData.get("telefone")),
    servicoNome: service.nome,
    servicoId: service.id,
    valor: Number(service.valor) || 0,
    duracao: Number(service.duracao) || 30,
    barbeiroId: barber.id,
    data: dateInput.value,
    horario: time,
    status: "agendado"
  };

  bookingSubmitting = true;
  continueButton.disabled = true;
  formMessage.textContent = "Salvando seu agendamento...";
  try {
    const { error } = await supabaseClient.from("customer_appointments").insert({
      id: appointment.id,
      client_user_id: customerUser.id,
      cliente: appointment.cliente,
      telefone: appointment.telefone,
      servico_id: appointment.servicoId,
      servico_nome: appointment.servicoNome,
      valor: appointment.valor,
      duracao: appointment.duracao,
      barbeiro_id: appointment.barbeiroId,
      data: appointment.data,
      horario: appointment.horario,
      status: appointment.status
    });
    if (error) throw error;
    data.agendamentos.push(appointment);
    persistLocalData();
  } catch (error) {
    formMessage.textContent = "Não foi possível salvar o agendamento online. Confira sua conexão e tente novamente.";
    console.error("Erro ao salvar agendamento:", error);
    return;
  } finally {
    bookingSubmitting = false;
    updateContinueButton();
  }

  highestStep = 3;
  bookingConfirmed = true;
  $$(".booking-step").forEach((panel) => {
    panel.hidden = true;
    panel.classList.remove("active");
  });
  $("#successStep").hidden = false;
  $("#successStep").classList.add("active");
  $(".stepper").hidden = true;
  bookingBar.hidden = true;
  $("#successDetails").textContent =
    `${formatDate(appointment.data)} às ${appointment.horario} · ${service.nome} com ${barber.nome}.`;
  const whatsappMessage = [
    "Olá, Imperium Barber! Acabei de fazer um agendamento.",
    "",
    `Nome: ${appointment.cliente}`,
    `Serviço: ${service.nome}`,
    `Profissional: ${barber.nome}`,
    `Data: ${formatDate(appointment.data)}`,
    `Horário: ${appointment.horario}`,
    `Valor: ${money(appointment.valor)}`
  ].join("\n");
  $("#whatsappConfirmation").href =
    `https://wa.me/${BARBERSHOP_WHATSAPP}?text=${encodeURIComponent(whatsappMessage)}`;
  $("#successStep").scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetBooking() {
  form.reset();
  bookingConfirmed = false;
  selectedServiceId = "";
  selectedBarberId = "";
  selectedTime = "";
  dateInput.value = today();
  highestStep = 1;
  $(".stepper").hidden = false;
  $("#successStep").hidden = true;
  setStep(1);
  renderServices();
  renderBarbers();
  updateBookingSummary();
}

function refresh() {
  renderServices();
  renderBarbers();
  renderTimeSlots();
  updateBookingSummary();
  updateContinueButton();
  if (customerUser) renderClientAppointments();

  const dataError = $("#dataError");
  dataError.hidden = !loadError;
  if (loadError) {
    dataError.textContent = "Não foi possível carregar os serviços ou agendamentos online. Confira a configuração do Supabase e tente novamente.";
  }
}

async function handleStorageUpdate() {
  try {
    data = loadData();
    await loadSharedServices();
    await loadSharedAppointments();
    loadError = false;
    $("#dataError").hidden = true;
    refresh();
  } catch (error) {
    loadError = true;
    refresh();
    console.error("Erro ao atualizar os dados do painel:", error);
  }
}

dateInput.min = today();
dateInput.value = today();
$("#currentYear").textContent = new Date().getFullYear();

serviceList.addEventListener("click", (event) => {
  if (event.target.closest("[data-service-id]")) updateContinueButton();
});

barberSelect.addEventListener("change", () => {
  selectedBarberId = barberSelect.value;
  renderTimeSlots();
});

dateInput.addEventListener("change", () => {
  selectedTime = "";
  renderTimeSlots();
});

continueButton.addEventListener("click", () => {
  if (activeStep === 1 && selectedService()) {
    highestStep = Math.max(highestStep, 2);
    setStep(2);
  } else if (activeStep === 2 && selectedTime) {
    highestStep = Math.max(highestStep, 3);
    setStep(3);
  } else if (activeStep === 3) {
    confirmBooking();
  }
});

$$("[data-step-link]").forEach((button) => {
  button.addEventListener("click", () => {
    const step = Number(button.dataset.stepLink);
    if (!button.disabled && step <= highestStep) setStep(step);
  });
});

$$("[data-back]").forEach((button) => {
  button.addEventListener("click", () => setStep(Number(button.dataset.back)));
});

$("#bookingTab").addEventListener("click", () => setView("booking"));
$("#galleryTab").addEventListener("click", () => setView("gallery"));
$("#appointmentsTab").addEventListener("click", () => setView("appointments"));
$(".gallery-book-button").addEventListener("click", () => {
  setView("booking");
  setStep(1);
  $("#bookingView").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("#newBookingButton").addEventListener("click", resetBooking);

$("#editAccountPhoneButton").addEventListener("click", () => {
  const accountPhoneForm = $("#accountPhoneForm");
  accountPhoneForm.hidden = !accountPhoneForm.hidden;
  if (!accountPhoneForm.hidden) {
    accountPhoneForm.elements.telefone.value = appointmentLookupPhone;
    accountPhoneForm.elements.telefone.focus();
  }
});

$("#accountPhoneForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const accountPhoneForm = event.currentTarget;
  if (!accountPhoneForm.reportValidity()) return;
  const phone = normalizePhone(new FormData(accountPhoneForm).get("telefone"));
  if (!isValidPhone(phone)) {
    accountPhoneForm.elements.telefone.setCustomValidity("Informe exatamente 11 números, incluindo o DDD.");
    accountPhoneForm.elements.telefone.reportValidity();
    accountPhoneForm.elements.telefone.setCustomValidity("");
    return;
  }

  const submitButton = accountPhoneForm.querySelector("[type='submit']");
  submitButton.disabled = true;
  $("#lookupMessage").textContent = "Atualizando o telefone da conta...";
  try {
    const updatedMetadata = { ...customerUser.user_metadata, telefone: phone };
    const { data: authData, error } = await supabaseClient.auth.updateUser({ data: updatedMetadata });
    if (error) throw error;
    customerUser = authData.user;
    appointmentLookupPhone = phone;
    form.elements.telefone.defaultValue = phone;
    form.elements.telefone.value = phone;
    form.elements.telefone.readOnly = true;
    form.elements.telefone.setAttribute("aria-label", "Telefone cadastrado na sua conta");
    $("#accountPhoneDisplay").textContent = phone;
    accountPhoneForm.hidden = true;
    $("#lookupMessage").textContent = "Telefone atualizado. Carregando seus agendamentos...";
  } catch (error) {
    $("#lookupMessage").textContent = "Não foi possível atualizar o telefone. Tente novamente.";
    console.error("Erro ao atualizar telefone da conta:", error);
    return;
  } finally {
    submitButton.disabled = false;
  }

  try {
    await refreshSharedAppointments();
    $("#lookupMessage").textContent = data.agendamentos.length
      ? "Telefone atualizado. Seus agendamentos estão abaixo."
      : "Telefone atualizado. Ainda não encontramos agendamentos associados a este número.";
  } catch (error) {
    $("#lookupMessage").textContent = "Telefone atualizado, mas não foi possível consultar os agendamentos. Confira a configuração do Supabase e tente novamente.";
    console.error("Erro ao consultar agendamentos após atualizar telefone:", error);
  }
});

$$("[data-auth-view]").forEach((button) => {
  button.addEventListener("click", () => setAuthView(button.dataset.authView));
});

$$('input[type="tel"]').forEach((input) => {
  input.addEventListener("input", () => {
    input.value = normalizePhone(input.value).slice(0, 11);
    if (input.form === form) updateContinueButton();
  });
});

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const loginForm = event.currentTarget;
  if (!loginForm.reportValidity()) return;
  const submitButton = loginForm.querySelector("[type='submit']");
  submitButton.disabled = true;
  authMessage.textContent = "Verificando acesso...";
  try {
    const { data: authData, error } = await supabaseClient.auth.signInWithPassword({
      email: new FormData(loginForm).get("email").trim().toLowerCase(),
      password: new FormData(loginForm).get("password")
    });
    if (error) {
      authMessage.textContent = "Não foi possível entrar. Confira o e-mail e a senha.";
      console.error("Erro ao autenticar cliente:", error);
      return;
    }
    await initializeClient(authData.user);
  } catch (error) {
    authMessage.textContent = "Ocorreu um erro ao entrar. Tente novamente.";
    console.error("Erro ao entrar na conta do cliente:", error);
  } finally {
    submitButton.disabled = false;
  }
});

$("#signupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const signupForm = event.currentTarget;
  if (!signupForm.reportValidity()) return;
  const values = Object.fromEntries(new FormData(signupForm));
  if (!isValidPhone(values.telefone)) {
    signupForm.elements.telefone.setCustomValidity("Informe exatamente 11 números, incluindo o DDD.");
    signupForm.elements.telefone.reportValidity();
    signupForm.elements.telefone.setCustomValidity("");
    return;
  }
  const submitButton = signupForm.querySelector("[type='submit']");
  submitButton.disabled = true;
  authMessage.textContent = "Criando sua conta...";
  try {
    const { data: authData, error } = await supabaseClient.auth.signUp({
      email: values.email.trim().toLowerCase(),
      password: values.password,
      options: {
        data: {
          full_name: values.name.trim(),
          telefone: normalizePhone(values.telefone)
        }
      }
    });
    if (error) {
      authMessage.textContent = "Não foi possível criar a conta. Confira os dados e tente novamente.";
      console.error("Erro ao cadastrar cliente:", error);
      return;
    }
    if (authData.session) {
      await initializeClient(authData.user);
      return;
    }
    setAuthView("login", "Conta criada. Confira seu e-mail para confirmar o cadastro e depois entre.");
  } catch (error) {
    authMessage.textContent = "Ocorreu um erro ao criar sua conta. Tente novamente.";
    console.error("Erro ao cadastrar conta do cliente:", error);
  } finally {
    submitButton.disabled = false;
  }
});

$("#forgotForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const forgotForm = event.currentTarget;
  if (!forgotForm.reportValidity()) return;
  const submitButton = forgotForm.querySelector("[type='submit']");
  submitButton.disabled = true;
  authMessage.textContent = "Enviando...";
  try {
    const email = new FormData(forgotForm).get("email").trim().toLowerCase();
    const recoveryOptions = ["http:", "https:"].includes(window.location.protocol)
      ? { redirectTo: window.location.href.split("#")[0] }
      : undefined;
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, recoveryOptions);
    if (error) {
      authMessage.textContent = describeAuthError(error, "Não foi possível enviar o link:");
      console.error("Erro ao solicitar recuperação de senha:", error);
      return;
    }
    authMessage.textContent = recoveryOptions
      ? "Se houver uma conta com esse e-mail, enviaremos um link para redefinir sua senha."
      : "Solicitação enviada. Confira seu e-mail; o link abrirá o endereço padrão configurado no Supabase.";
  } catch (error) {
    authMessage.textContent = describeAuthError(error, "Falha ao solicitar o link:");
    console.error("Erro na solicitação de recuperação de senha:", error);
  } finally {
    submitButton.disabled = false;
  }
});

$("#resetForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const resetForm = event.currentTarget;
  if (!resetForm.reportValidity()) return;
  const values = Object.fromEntries(new FormData(resetForm));
  if (values.password !== values.passwordConfirmation) {
    resetForm.elements.passwordConfirmation.setCustomValidity("As senhas não são iguais.");
    resetForm.elements.passwordConfirmation.reportValidity();
    resetForm.elements.passwordConfirmation.setCustomValidity("");
    return;
  }
  const submitButton = resetForm.querySelector("[type='submit']");
  submitButton.disabled = true;
  authMessage.textContent = "Salvando nova senha...";
  try {
    const { data: authData, error } = await supabaseClient.auth.updateUser({ password: values.password });
    if (error) {
      authMessage.textContent = error.code === "weak_password"
        ? `A senha não atende aos requisitos: ${error.message}`
        : "Não foi possível alterar a senha. O link pode ter expirado; solicite uma nova recuperação.";
      console.error("Erro ao redefinir senha:", error);
      return;
    }
    recoveryRequested = false;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    await initializeClient(authData.user);
  } catch (error) {
    authMessage.textContent = "Ocorreu um erro ao alterar a senha. Tente novamente.";
    console.error("Erro ao redefinir senha:", error);
  } finally {
    submitButton.disabled = false;
  }
});

$("#logoutButton").addEventListener("click", async () => {
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    showAuth("Você saiu da sua conta.");
  } catch (error) {
    console.error("Erro ao sair da conta:", error);
    $("#bookingFeedback").textContent = "Não foi possível sair da conta. Tente novamente.";
    $("#bookingFeedback").hidden = false;
  }
});

supabaseClient.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") {
    recoveryRequested = true;
    showAuth();
    setAuthView("reset");
  } else if (event === "SIGNED_OUT") {
    clientDataReady = false;
    customerUser = null;
    authView = "login";
    showAuth();
  }
});

async function initializeClient(user) {
  customerUser = user;
  if (!clientDataReady) {
    try {
      data = loadData();
      try {
        await loadSharedServices();
      } catch (error) {
        loadError = true;
        console.error("Erro ao carregar serviços compartilhados:", error);
      }
      try {
        await loadSharedAppointments();
      } catch (error) {
        loadError = true;
        console.error("Erro ao carregar os agendamentos compartilhados:", error);
      }
      clientDataReady = true;
      refresh();
    } catch (error) {
      data = structuredClone(INITIAL_DATA);
      loadError = true;
      clientDataReady = true;
      refresh();
      setStep(1);
      console.error("Erro ao carregar os dados do painel:", error);
    }
  }
  enterCustomerApp(user);
}

async function initializeAuth() {
  const recoveryError = authUrlParams.get("error_description") || authUrlParams.get("error");
  if (recoveryRequested) {
    showAuth();
    setAuthView("reset", "Defina uma nova senha para sua conta.");
  } else if (recoveryError) {
    showAuth();
    setAuthView("login", `Não foi possível abrir o link de recuperação: ${recoveryError}`);
  } else {
    showAuth();
  }
  try {
    const { data: sessionData, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (!(sessionData.session && sessionData.session.user)) {
      if (recoveryRequested) {
        setAuthView("reset", "Este link expirou ou já foi usado. Solicite uma nova recuperação de senha.");
      }
      return;
    }
    if (recoveryRequested) {
      showAuth();
      setAuthView("reset", "Defina uma nova senha para sua conta.");
      return;
    }
    await initializeClient(sessionData.session.user);
  } catch (error) {
    showAuth("Não foi possível verificar sua sessão. Atualize a página e tente novamente.");
    console.error("Erro ao verificar a sessão do cliente:", error);
  }
}

void initializeAuth();

window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) void handleStorageUpdate();
});
