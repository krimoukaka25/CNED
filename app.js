import { alertInstances, conversations, demoAccounts, documents, portfolioValues, projects } from './data/demo.js';
import {
  djendjenOperationalFields,
  djendjenTechnicalLots,
  pendingAmendments,
  referenceActions,
  referenceAlerts,
  referenceProjects,
  referenceSource,
  referenceStatus,
  referenceSummary
} from './data/cned-reference.js';
import { wilayas, wilayaSource } from './data/wilayas.js';
import { westernSaharaLabelPoint, westernSaharaNorthBorder } from './data/western-sahara.js';

const app = document.querySelector('#app');
let leafMaps = [];
let mapConfig = null;
try {
  const configResponse = await fetch('./map-config.json', { cache: 'no-store' });
  if (configResponse.ok) {
    mapConfig = await configResponse.json();
  } else if (configResponse.status !== 404) {
    throw new Error(`Impossible de charger la configuration cartographique (${configResponse.status}).`);
  }
} catch (error) {
  console.warn('Configuration des tuiles cartographiques indisponible; seules les données géographiques locales seront affichées.', error);
}
const saved = (key, fallback, storageType = 'local') => {
  let storage;
  try {
    storage = storageType === 'session' ? sessionStorage : localStorage;
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn(`Invalid local prototype state in ${key}; resetting this value.`, error);
      try {
        storage.removeItem(key);
      } catch (storageError) {
        console.warn(`Could not reset local prototype state in ${key}.`, storageError);
      }
      return fallback;
    }
  } catch (error) {
    console.warn(`Could not read local prototype state in ${key}; using the default.`, error);
    return fallback;
  }
};
const loadReferenceMessageJournal = () => {
  try {
    const raw = localStorage.getItem('cned-reference-message-journal');
    const entries = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(entries)) throw new TypeError('Expected an array of journal entries.');
    const validEntries = entries.filter((entry) => entry && typeof entry === 'object' && typeof entry.projectSlug === 'string');
    if (validEntries.length !== entries.length) {
      console.warn('Invalid entries were omitted from the reference message journal.');
    }
    return validEntries;
  } catch (error) {
    console.warn('Reference message journal is unavailable; using an in-memory journal.', error);
    return [];
  }
};
const persistReferenceMessageJournal = (entries) => {
  try {
    localStorage.setItem('cned-reference-message-journal', JSON.stringify(entries));
    return true;
  } catch (error) {
    console.warn('Reference message journal could not be persisted.', error);
    return false;
  }
};

let reference;
try {
  const referenceResponse = await fetch('./data/reference.json');
  if (!referenceResponse.ok) throw new Error(`Impossible de charger le référentiel KPI (${referenceResponse.status}).`);
  reference = await referenceResponse.json();
} catch (error) {
  console.error(error);
  app.innerHTML = `<main class="container py-5"><div class="card"><div class="card-body"><h4>Chargement impossible</h4><p class="text-muted">Le référentiel local n’a pas pu être chargé. Ouvrez l’application avec un serveur web local, puis rechargez la page.</p><pre class="small text-danger">${String(error.message).replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char])}</pre></div></div></main>`;
}
if (!reference) throw new Error('Référentiel non chargé; le prototype ne peut pas démarrer.');

const state = {
  user: saved('cned-demo-user', null) || saved('cned-demo-session', null, 'session'),
  lang: saved('cned-language', 'fr'),
  page: 'dashboard',
  projectId: null,
  projectTab: 'overview',
  alertTab: 'instances',
  kpiFilters: saved('cned-kpi-filters', {}),
  alertFilters: saved('cned-alert-filters', {}),
  documentFilters: saved('cned-document-filters', {}),
  mapFilters: saved('cned-map-filters', {}),
  projectStatus: saved('cned-project-status', ''),
  projectSort: saved('cned-project-sort', 'name'),
  referencePortfolioQuery: '',
  referencePortfolioStatus: '',
  referenceMessageJournal: loadReferenceMessageJournal(),
  reportPeriod: saved('cned-report-period', '12 derniers mois'),
  selectedMapProject: null,
  mapFocusSlug: null,
  mapView: 'map',
  referenceProjectTab: 'synthese',
  referenceProjectId: 'djendjen',
  selectedConversation: 'project-001',
  tablePages: {},
  alertChanges: saved('cned-alert-changes', {}),
  localDocuments: saved('cned-local-documents', []),
  fieldReports: saved('cned-field-reports', []),
  referenceOperationalUpdates: saved('cned-reference-field-updates', {}),
  messages: saved('cned-messages', {}),
  notificationsRead: saved('cned-notifications-read', []),
  globalSearch: '',
  pendingMessageAttachment: '',
  photoPreviewUrl: '',
  chatAttachmentPreviewUrl: '',
  toastTimer: null
};

const roles = {
  direction: {
    name: 'Direction CNED',
    workspace: 'I7 · Pilotage CNED',
    nav: ['dashboard', 'portfolio', 'kpis', 'alerts', 'map', 'messages', 'reports', 'notifications'],
    intro: 'Vision nationale, arbitrages et décisions stratégiques.',
    projectAction: 'Consultation seule'
  },
  pmo: {
    name: 'CNED / PMO',
    workspace: 'I7 · Pilotage CNED',
    nav: ['dashboard', 'reference-project', 'portfolio', 'kpis', 'alerts', 'finance', 'planning', 'map', 'documents', 'messages', 'reports', 'notifications'],
    intro: 'Analyse du portefeuille, fiabilité des données et coordination des actions.',
    projectAction: 'Pilotage analytique'
  },
  mo: {
    name: 'Maître d’ouvrage',
    workspace: 'I2 · MO local',
    nav: ['dashboard', 'portfolio', 'technical', 'finance', 'planning', 'field', 'kpis', 'alerts', 'documents', 'messages', 'reports', 'notifications'],
    intro: 'Suivi opérationnel limité aux projets de votre maîtrise d’ouvrage.',
    projectAction: 'Saisie opérationnelle'
  },
  bet: {
    name: 'BET / Contrôle',
    workspace: 'I4 · BET / CTC',
    nav: ['dashboard', 'portfolio', 'technical', 'planning', 'field', 'kpis', 'alerts', 'documents', 'messages', 'reports'],
    intro: 'Contrôle technique, qualité, non-conformités et réceptions.',
    projectAction: 'Suivi technique'
  },
  contractor: {
    name: 'Contractant',
    workspace: 'I1 · Terrain',
    nav: ['dashboard', 'portfolio', 'technical', 'planning', 'field', 'kpis', 'alerts', 'documents', 'messages', 'notifications'],
    intro: 'Activité de vos contrats uniquement — aucune donnée de concurrents.',
    projectAction: 'Déclaration terrain'
  },
  finance: {
    name: 'Contrôle budgétaire',
    workspace: 'I3 · Financier',
    nav: ['dashboard', 'portfolio', 'finance', 'kpis', 'alerts', 'documents', 'reports', 'notifications'],
    intro: 'Suivi AE, CP et paiements dans le périmètre budgétaire attribué.',
    projectAction: 'Suivi financier'
  }
};

const roleKeyFor = (user) => {
  if (!user) return null;
  return ({ national: user.username === 'direction' ? 'direction' : 'pmo', mo: 'mo', bet: 'bet', contractor: 'contractor', finance: 'finance' })[user.scope] || 'pmo';
};

const pageMeta = {
  dashboard: ['Tableau de bord', 'bx-grid-alt'],
  portfolio: ['Portefeuille des projets', 'bx-briefcase-alt-2'],
  technical: ['Suivi technique', 'bx-wrench'],
  finance: ['Suivi financier', 'bx-wallet'],
  planning: ['Planning & jalons', 'bx-calendar'],
  field: ['Terrain & rapports', 'bx-map-pin'],
  kpis: ['KPI & performance', 'bx-bar-chart-alt-2'],
  alerts: ['Risques & alertes', 'bx-bell'],
  map: ['Carte nationale', 'bx-map'],
  documents: ['Documents', 'bx-folder-open'],
  messages: ['Communication', 'bx-message-rounded-dots'],
  reports: ['Rapports & analyses', 'bx-file'],
  notifications: ['Notifications', 'bx-notification']
  //'reference-project': ['Espace projet · Djendjen', 'bx-building-house']
};

const translations = {
  fr: {},
  ar: {
    'Tableau de bord': 'لوحة القيادة',
    'Portefeuille des projets': 'محفظة المشاريع',
    'Suivi technique': 'المتابعة التقنية',
    'Suivi financier': 'المتابعة المالية',
    'Planning & jalons': 'التخطيط والمراحل',
    'Terrain & rapports': 'الميدان والتقارير',
    'KPI & performance': 'مؤشرات الأداء',
    'Risques & alertes': 'المخاطر والتنبيهات',
    'Carte nationale': 'الخريطة الوطنية',
    Documents: 'الوثائق',
    Communication: 'التواصل',
    'Suivi et communication': 'المتابعة والتواصل',
    'Rapports & analyses': 'التقارير والتحليلات',
    Notifications: 'الإشعارات',
    'Déconnexion': 'تسجيل الخروج',
    'KPI & performance': 'مؤشرات الأداء',
    'Risques & alertes': 'المخاطر والتنبيهات',
    'Suivi financier': 'المتابعة المالية',
    'Documents': 'الوثائق',
    'Démo locale · données illustratives': 'نسخة تجريبية · بيانات توضيحية',
    'Bonjour': 'مرحباً',
    'Rechercher un projet, KPI…': 'البحث عن مشروع أو مؤشر…',
    'Accès à votre espace': 'الدخول إلى مساحتك',
    'Se connecter': 'تسجيل الدخول',
    'Mot de passe oublié ?': 'هل نسيت كلمة المرور؟',
    'Mes projets': 'مشاريعي',
    'Projets visibles': 'المشاريع المتاحة',
    'Centre des alertes': 'مركز التنبيهات',
    'Catalogue des indicateurs': 'دليل المؤشرات',
    'Aucune alerte active dans votre périmètre.': 'لا توجد تنبيهات نشطة ضمن نطاقك.',
    Portefeuille: 'المحفظة',
    'Nouvelle alerte': 'تنبيه جديد',
    'Espace projet · Djendjen': 'مساحة المشروع · جيجل',
    'Tableau de bord · portefeuille CNED': 'لوحة القيادة · محفظة CNED'
  }
};

const t = (text) => translations[state.lang]?.[text] || text;
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const numeric = (value) => Number.parseFloat(String(value ?? '').replace(',', '.'));
const role = () => roles[roleKeyFor(state.user)];
const matrixRole = () => state.user?.role;
const rolePermission = (type, id) => reference.permissions[type]?.[id]?.[matrixRole()] || '';
const canViewFinancialData = () => visibleKPIs().some((item) => item.Famille?.startsWith('FI'));
const projectById = (id) => projects.find((project) => project.id === id);
const kpiById = (id) => reference.kpis.find((item) => item.KPI_ID === id);
const alertRule = (id) => reference.alerts.find((item) => item.Regle_ID === id);
const allScopedProjects = () => {
  if (!state.user) return [];
  if (state.user.scope === 'national') return projects;
  if (state.user.scope === 'contractor') return projects.filter((project) => project.contractor === state.user.contractor);
  if (state.user.scope === 'bet') return projects.filter((project) => project.bet === state.user.organization);
  if (state.user.scope === 'mo') return projects.filter((project) => project.owner === state.user.organization);
  if (state.user.scope === 'finance') return projects.filter((project) => project.assigned.includes('finance'));
  return [];
};
const scopedProjectIds = () => new Set(allScopedProjects().map((project) => project.id));
const visibleKPIs = () => reference.kpis.filter((item) => rolePermission('kpis', item.KPI_ID));
const currentInstances = () => alertInstances.filter((instance) => {
  const permitted = rolePermission('alerts', instance.ruleId);
  return permitted && scopedProjectIds().has(instance.projectId);
});
const visibleAlertRules = () => reference.alerts.filter((item) => rolePermission('alerts', item.Regle_ID));
const visibleDocuments = () => [...documents, ...state.localDocuments].filter((document) => {
  if (!scopedProjectIds().has(document.projectId)) return false;
  if (document.access?.includes('financier') && !['direction', 'pmo', 'finance', 'mo'].includes(roleKeyFor(state.user))) return false;
  if (document.access?.includes('juridique') && !['direction', 'pmo', 'mo'].includes(roleKeyFor(state.user))) return false;
  return true;
});

const valueFor = (item, project = null) => {
  if (project) return project.values?.[item.KPI_ID] ?? '—';
  if (state.user?.scope === 'national') return portfolioValues[item.KPI_ID] ?? '—';
  const values = allScopedProjects().map((entry) => entry.values?.[item.KPI_ID]).filter((value) => value !== undefined && value !== null);
  if (!values.length) return '—';
  if (item.KPI_ID === 'QR5') return Math.max(...values.map(Number));
  if (item.KPI_ID === 'QR6') return values.includes('Oui') ? 'Oui' : 'Non';
  if (item.KPI_ID === 'QR8') return values.reduce((total, value) => total + Number(value), 0);
  if (values.every((value) => typeof value === 'string')) return values[0];
  return values.reduce((total, value) => total + Number(value), 0) / values.length;
};

function statusFor(item, value, project = null) {
  if (value === '—' || value === null || value === undefined) return 'info';
  const sens = item.Sens || '';
  if (sens === 'Information' || sens === 'Règle spéciale') {
    if (item.KPI_ID === 'QR5') {
      const solutionValidated = project
        ? Boolean(project.values?.QR5Solution)
        : allScopedProjects().some((entry) => Number(entry.values?.QR5) > 0 && entry.values?.QR5Solution);
      return Number(value) === 0 ? 'green' : solutionValidated ? 'orange' : 'red';
    }
    if (item.KPI_ID === 'QR6') return value === 'Oui' ? 'red' : 'green';
    if (item.KPI_ID === 'QR8') return Number(value) > 0 ? 'red' : 'green';
    return 'info';
  }
  const actual = Number(value);
  const green = numeric(item.Seuil_Vert);
  const red = numeric(item.Seuil_Rouge);
  if (!Number.isFinite(actual) || !Number.isFinite(green) || !Number.isFinite(red)) return 'info';
  if (sens === 'Écart absolu') {
    if (Math.abs(actual) <= green) return 'green';
    return Math.abs(actual) > red ? 'red' : 'orange';
  }
  if (sens === 'Plus haut = mieux') {
    if (actual >= green) return 'green';
    return actual < red ? 'red' : 'orange';
  }
  if (actual <= green) return 'green';
  return actual > red ? 'red' : 'orange';
}

function formatValue(item, value) {
  if (value === 'Oui' || value === 'Non') return value;
  if (typeof value !== 'number' && !Number.isFinite(numeric(value))) return String(value);
  const n = Number(value);
  const digits = Math.abs(n) < 10 && !Number.isInteger(n) ? 2 : 0;
  const formatted = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(n);
  if (item.Unité === '%') return `${formatted} %`;
  if (item.Unité === 'ratio') return formatted;
  if (item.Unité === 'pts') return `${formatted} pts`;
  if (item.Unité === 'j') return `${formatted} j`;
  if (item.Unité === 'mois') return `${formatted} mois`;
  if (item.Unité === 'nombre') return formatted;
  if (item.Unité === '0–100') return `${formatted} / 100`;
  return `${formatted} ${item.Unité || ''}`.trim();
}

const statusNames = { red: 'ROUGE', orange: 'ORANGE', green: 'VERT', info: 'INFORMATION' };
const statusClass = (status) => ({ red: 'status-red', orange: 'status-orange', green: 'status-green', info: 'status-info' })[status] || 'status-info';
const statusPill = (status, label = statusNames[status] || status) => `<span class="status-pill ${statusClass(status)}">${escapeHTML(t(label))}</span>`;
const alertCondition = (rule) => rule?.['Condition (lisible)'] || '—';
const importanceBadge = (value) => `<span class="priority-mark">${escapeHTML(value || '—')}</span>`;
const projectStatusClass = (status) => {
  if (status === 'À l’arrêt' || status === 'En retard') return 'red';
  if (status === 'À surveiller' || status === 'Données à vérifier') return 'orange';
  return 'green';
};
const projectStatus = (project) => statusPill(projectStatusClass(project.status), project.status);
const shortDate = (date) => new Intl.DateTimeFormat(state.lang === 'ar' ? 'ar-DZ' : 'fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00`));
const money = (value) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)} Md DA`;
const sum = (items, getter) => items.reduce((total, item) => total + getter(item), 0);
const initials = (name = '') => name.split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();

function pageHeading(title, subtitle, actions = '') {
  return `<div class="page-heading"><div><h4>${escapeHTML(t(title))}</h4><p class="page-subtitle">${escapeHTML(subtitle)}</p></div><div class="d-flex flex-wrap gap-2">${actions}</div></div>`;
}

function demoBanner() {
  return `<div class="demo-banner"><i class="bx bx-info-circle"></i><span>${escapeHTML(t('Démo locale · données illustratives'))}. Les projets, valeurs et alertes sont fictifs et ne constituent pas une information officielle CNED.</span></div>`;
}

function metricCard(label, value, iconName, context = '', click = '') {
  if (click && !rolePermission('kpis', click)) return '';
  const target = click ? `data-kpi-id="${escapeHTML(click)}"` : '';
  const clickable = click ? ' is-clickable' : '';
  // Same visual language as the Direction tiles (kpiTile): accent border, uppercase label, tinted icon.
  const tone = metricTone(iconName, label);
  const parts = String(value).match(/^(.*\S)\s+(Md DA|%)$/);
  const valueHtml = parts ? `<strong>${escapeHTML(parts[1])}</strong><span class="kpi-tile-unit">${escapeHTML(parts[2])}</span>` : `<strong>${escapeHTML(value)}</strong>`;
  return `<div class="col-sm-6 col-xl-3"><article class="kpi-tile kpi-tone-${tone} metric-tile${clickable}" ${target}><div class="kpi-tile-top"><span class="kpi-tile-label">${escapeHTML(t(label))}</span><span class="kpi-tile-icon"><i class="bx ${iconName}" aria-hidden="true"></i></span></div><div class="kpi-tile-value">${valueHtml}</div>${context ? `<small class="kpi-tile-note">${escapeHTML(context)}</small>` : ''}</article></div>`;
}

function metricTone(iconName = '', label = '') {
  if (/error|time-five/.test(iconName) || /critique|arrêt/i.test(label)) return 'red';
  if (/bell|exclamation|search-alt|transfer/.test(iconName) || /dérive|surveiller|attente/i.test(label)) return 'amber';
  if (/trending|check|flag/.test(iconName)) return 'green';
  return 'blue';
}

const taskTone = (status) => ({ Prioritaire: 'red', 'À vérifier': 'orange', 'À compléter': 'orange', 'En cours': 'info', Planifiée: 'green' })[status] || 'info';

function lineChart(label, points, labels = ['Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.']) {
  const width = 620;
  const height = 190;
  const left = 32;
  const top = 14;
  const usableWidth = width - left - 12;
  const usableHeight = height - 35;
  const min = Math.min(...points) - 5;
  const max = Math.max(...points) + 5;
  const coords = points.map((point, index) => {
    const x = left + (usableWidth * index) / Math.max(points.length - 1, 1);
    const y = top + usableHeight - ((point - min) / Math.max(max - min, 1)) * usableHeight;
    return [x, y];
  });
  const path = coords.map(([x, y], index) => `${index ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${path} L ${coords.at(-1)[0].toFixed(1)} ${height - 24} L ${coords[0][0].toFixed(1)} ${height - 24} Z`;
  const grid = [0, 1, 2].map((row) => {
    const y = top + (usableHeight * row) / 2;
    return `<line class="chart-grid" x1="${left}" y1="${y}" x2="${width - 10}" y2="${y}"/>`;
  }).join('');
  const marks = coords.map(([x, y]) => `<circle class="chart-dot" cx="${x}" cy="${y}" r="4"/>`).join('');
  const labelsSvg = labels.map((item, index) => `<text class="chart-label" x="${coords[index]?.[0] || left}" y="${height - 5}" text-anchor="middle">${escapeHTML(item)}</text>`).join('');
  return `<div class="chart-wrap"><div class="d-flex align-items-center justify-content-between mb-2"><span class="small text-muted">${escapeHTML(label)}</span><span class="small text-muted">${points.length} périodes illustratives</span></div><svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(label)}">${grid}<path class="chart-area" d="${area}"/><path class="chart-line" d="${path}"/>${marks}${labelsSvg}</svg></div>`;
}

function horizontalBars(rows) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return rows.map((row) => `<div class="financial-bar"><span class="financial-bar-label">${escapeHTML(row.label)}</span><div class="financial-bar-track" role="progressbar" aria-valuenow="${row.value}" aria-valuemin="0" aria-valuemax="${max}"><span style="width:${Math.min(100, row.value / max * 100)}%"></span></div><span class="financial-bar-value">${escapeHTML(row.display)}</span></div>`).join('');
}

function latestAlertRows(limit = 4) {
  const current = currentInstances().filter((instance) => !['Résolue', 'Clôturée'].includes(state.alertChanges[instance.id]?.status || instance.status)).slice(0, limit);
  if (!current.length) return '<div class="empty-state"><i class="bx bx-check-circle"></i>Aucune alerte active dans votre périmètre.</div>';
  return current.map((instance) => {
    const rule = alertRule(instance.ruleId);
    const project = projectById(instance.projectId);
    return `<div class="alert-row clickable" data-alert-id="${escapeHTML(instance.id)}"><span class="alert-severity ${rule?.Niveau === 'ORANGE' ? 'orange' : ''}"></span><span class="alert-row-content"><strong>${escapeHTML(instance.ruleId)} · ${escapeHTML(rule?.Nom || '')}</strong><span>${escapeHTML(project?.shortName || '')} · ${escapeHTML(instance.values)}</span></span>${statusPill(rule?.Niveau === 'ROUGE' ? 'red' : 'orange', rule?.Niveau || '')}</div>`;
  }).join('');
}

function smallProjectRows(items, limit = 5) {
  const rows = items.slice(0, limit);
  if (!rows.length) return '<tr><td colspan="5"><div class="empty-state">Aucun projet dans votre périmètre.</div></td></tr>';
  return rows.map((project) => `<tr><td><button class="btn btn-link p-0 text-start table-project-name" data-project-id="${escapeHTML(project.id)}">${escapeHTML(project.name)}</button><span class="table-project-meta">${escapeHTML(project.id)} · ${escapeHTML(project.owner)}</span></td><td>${escapeHTML(project.wilaya)}</td><td><div class="d-flex align-items-center gap-2"><div class="progress-slim"><span style="width:${project.physical}%"></span></div>${project.physical} %</div></td><td>${canViewFinancialData() ? money(project.budgetRevised) : '—'}</td><td>${projectStatus(project)}</td></tr>`).join('');
}

const referenceProjectBySlug = (slug) => referenceProjects.find((project) => project.slug === slug);
const referenceNumber = (value, digits = 3) => value == null
  ? 'Information indisponible'
  : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
const referencePercent = (value, digits = 1) => `${referenceNumber(value, digits)}\u00a0%`;
const referenceStatusBadge = (project) => {
  const status = referenceStatus(project);
  const color = status === 'À l’arrêt' ? 'red' : status === 'En retard' ? 'orange' : 'green';
  return statusPill(color, status);
};

function kpiTile({ label, value, valueHtml = '', unit = '', note, tone = 'blue', icon = 'bx-info-circle', ratio = null, wide = false }) {
  const ratioBar = Number.isFinite(ratio)
    ? `<div class="kpi-tile-ratio" role="progressbar" aria-label="${escapeHTML(label)}" aria-valuenow="${Math.max(0, Math.min(100, ratio))}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.max(0, Math.min(100, ratio))}%"></span></div>`
    : '';
  return `<article class="kpi-tile kpi-tone-${escapeHTML(tone)}${wide ? ' kpi-tile-wide' : ''}"><div class="kpi-tile-top"><span class="kpi-tile-label">${escapeHTML(label)}</span><span class="kpi-tile-icon"><i class="bx ${escapeHTML(icon)}" aria-hidden="true"></i></span></div><div class="kpi-tile-value">${valueHtml || `<strong>${escapeHTML(value)}</strong>`}${unit ? `<span class="kpi-tile-unit">${escapeHTML(unit)}</span>` : ''}</div>${ratioBar}<small class="kpi-tile-note">${escapeHTML(note)}</small></article>`;
}

function referenceExecutiveDashboard() {
  const summary = referenceSummary();
  const weightedGap = summary.weightedFinancial - summary.weightedPhysical;
  const ordered = [...referenceProjects].sort((a, b) => (b.financial - b.physical) - (a.financial - a.physical));
  const projectStatusCount = (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`;
  const projectsTable = referenceProjects.map((project) => {
    const projectAlerts = referenceAlerts(project);
    const critical = projectAlerts.some((alert) => alert.severity === 'Critique');
    const gap = project.financial - project.physical;
    const delayWidth = Math.max(0, Math.min(100, project.timeConsumed));
    const alertTone = critical ? 'red' : projectAlerts.length ? 'orange' : 'green';
    const gapTone = gap > 0 ? 'ahead' : 'behind';
    return `<tr class="reference-row-link" data-reference-project="${escapeHTML(project.slug)}" tabindex="0" role="link" aria-label="Ouvrir la fiche de ${escapeHTML(project.name)}">
      <td class="reference-dashboard-project"><strong>${escapeHTML(project.name)}</strong><span>${escapeHTML(project.id)}</span>${referenceStatusBadge(project)}</td>
      <td>${escapeHTML(project.sector)}</td><td>${escapeHTML(project.wilayas.join(', '))}</td>
      <td>${statusPill(alertTone, projectAlerts.length)}</td>
      <td><strong class="reference-gap-value ${gapTone}">${gap > 0 ? '+' : '−'}${referenceNumber(Math.abs(gap), 0)} pts</strong></td>
      <td><div class="reference-delay"><span><i class="${project.timeConsumed >= 100 ? 'late' : ''}" style="width:${delayWidth}%"></i></span><strong>${referencePercent(project.timeConsumed)}</strong></div></td>
      <td><div class="reference-observation" title="${escapeHTML(project.observation)}">${escapeHTML(project.observation)}</div></td>
    </tr>`;
  }).join('');
  const alerts = summary.alerts.slice().sort((a, b) => (a.severity === 'Critique' ? 0 : 1) - (b.severity === 'Critique' ? 0 : 1));
  const alertRows = alerts.map((item) => `<tr>
    <td>${statusPill(item.severity === 'Critique' ? 'red' : 'orange', item.severity)}</td>
    <td><button class="btn btn-link p-0 text-start table-project-name" data-reference-project="${item.project.slug}">${escapeHTML(item.project.name)}</button></td>
    <td>${escapeHTML(item.title)}</td><td>${escapeHTML(item.project.observation)}</td><td>${escapeHTML(item.action)}</td>
  </tr>`).join('');
  const amendmentRows = pendingAmendments.map((item) => `<tr><td>${escapeHTML(item.project)}</td><td>${escapeHTML(item.object)}</td><td class="text-end">${item.amount == null ? 'Information indisponible' : referenceNumber(item.amount)}</td><td>${escapeHTML(item.status)}</td></tr>`).join('');
  const actions = referenceProjects.filter((project) => project.recommendation !== 'Aucune recommandation dans la fiche CNED.').map((project) => `<div class="reference-action-row">
    <div><strong>${escapeHTML(project.name)}</strong><span>${escapeHTML(project.recommendation)}</span></div>${referenceStatusBadge(project)}
    <button class="btn btn-sm btn-outline-primary" data-reference-project="${project.slug}">Consulter</button>
  </div>`).join('');
  const progressBars = ordered.map((project) => {
    const gap = project.financial - project.physical;
    const width = Math.min(100, Math.abs(gap) * 1.2);
    return `<div class="reference-gap-row reference-row-link" data-reference-project="${escapeHTML(project.slug)}" tabindex="0" role="link" aria-label="Ouvrir la fiche de ${escapeHTML(project.name)}"><span>${escapeHTML(project.name)}</span><div class="reference-gap-track"><span class="${gap > 0 ? 'ahead' : 'behind'}" style="width:${width}%"></span></div><strong class="${gap > 0 ? 'ahead' : 'behind'}">${gap > 0 ? '+' : '−'}${referenceNumber(Math.abs(gap), 0)} pts</strong></div>`;
  }).join('');
  const weightedBars = [
    { label: 'Avancement physique', value: summary.weightedPhysical, tone: 'physical' },
    { label: 'Avancement financier', value: summary.weightedFinancial, tone: 'financial' }
  ].map(({ label, value, tone }) => {
    const width = Math.max(0, Math.min(100, value));
    return `<div class="reference-weighted-bar"><div class="reference-weighted-label"><span>${escapeHTML(label)}</span><strong>${referencePercent(value)}</strong></div><div class="reference-weighted-track" role="progressbar" aria-label="${escapeHTML(label)}" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="100" aria-valuetext="${escapeHTML(referencePercent(value))}" title="${value} %"><span class="reference-weighted-fill ${tone}" style="width:${width}%"></span><i aria-hidden="true"></i></div></div>`;
  }).join('');
  const statusCounts = [
    ['À l’arrêt', summary.stoppedCount, 'red', 'bx-stop-circle'],
    ['En retard', summary.delayedCount, 'amber', 'bx-time-five'],
    ['À surveiller', summary.watchCount, 'blue', 'bx-show']
  ];
  const statusStrip = `<section class="dashboard-status-strip mb-4" aria-label="État des projets suivis">${statusCounts.map(([label, count, tone, iconName]) => `<button type="button" class="dashboard-status dashboard-status-${tone}" data-dashboard-status="${escapeHTML(label)}" aria-label="${count} ${escapeHTML(label)} : ouvrir le portefeuille filtré"><span class="dashboard-status-icon"><i class="bx ${iconName}" aria-hidden="true"></i></span><span class="dashboard-status-text"><strong>${count}</strong><small>${escapeHTML(label)}</small></span></button>`).join('')}<button type="button" class="dashboard-status dashboard-status-critical" data-nav="alerts" aria-label="${summary.criticalCount} alertes critiques : ouvrir les alertes"><span class="dashboard-status-icon"><i class="bx bx-error-circle" aria-hidden="true"></i></span><span class="dashboard-status-text"><strong>${summary.criticalCount}</strong><small>Alertes critiques · ${summary.alertCount} au total</small></span></button></section>`;
  const paidShare = (summary.totalPaid / summary.totalAe) * 100;
  const unpaidShare = (summary.unpaidCommitments / summary.totalAe) * 100;
  const uncommittedShare = Math.max(0, 100 - paidShare - unpaidShare);
  const stateTotal = Math.max(1, summary.projectCount);
  const stoppedEnd = (summary.stoppedCount / stateTotal) * 100;
  const delayedEnd = stoppedEnd + (summary.delayedCount / stateTotal) * 100;
  const alertsByProject = referenceProjects.map((project) => ({ project, alerts: referenceAlerts(project) })).filter((item) => item.alerts.length).sort((x, y) => y.alerts.filter((alert) => alert.severity === 'Critique').length - x.alerts.filter((alert) => alert.severity === 'Critique').length || y.alerts.length - x.alerts.length).slice(0, 4);
  const importantCount = summary.alertCount - summary.criticalCount;
  const analyticsRow = `<div class="row g-4 mb-4">
      <div class="col-12 col-lg-6 col-xl-4"><div class="card h-100"><div class="card-header">Répartition par état</div><div class="card-body dashboard-donut-body">
        <div class="dashboard-donut" role="img" aria-label="${summary.stoppedCount} à l’arrêt, ${summary.delayedCount} en retard, ${summary.watchCount} à surveiller sur ${summary.projectCount} projets" style="background:conic-gradient(var(--cned-red) 0 ${stoppedEnd}%, var(--cned-orange) ${stoppedEnd}% ${delayedEnd}%, var(--cned-blue) ${delayedEnd}% 100%)"><span><strong>${summary.projectCount}</strong><small>projets suivis</small></span></div>
        <ul class="dashboard-legend">${statusCounts.map(([label, count, tone]) => `<li><i class="dot-${tone}"></i><span>${escapeHTML(label)}</span><strong>${count}</strong><em>${referencePercent((count / stateTotal) * 100)}</em></li>`).join('')}</ul>
      </div></div></div>
      <div class="col-12 col-lg-6 col-xl-4"><div class="card h-100"><div class="card-header d-flex justify-content-between align-items-center"><span>Alertes par niveau</span><button class="btn btn-sm btn-link" data-nav="alerts">Voir les alertes</button></div><div class="card-body">
        ${[['Critique', summary.criticalCount, 'red'], ['Important', importantCount, 'orange']].map(([label, count, tone]) => `<div class="dashboard-meter"><div><span>${label}</span><strong>${count}</strong></div><div class="dashboard-meter-track" role="progressbar" aria-label="${label}" aria-valuenow="${count}" aria-valuemin="0" aria-valuemax="${summary.alertCount}"><span class="tone-${tone}" style="width:${summary.alertCount ? (count / summary.alertCount) * 100 : 0}%"></span></div></div>`).join('')}
        <h6 class="reference-gap-heading mt-4">Projets les plus exposés</h6>
        ${alertsByProject.map(({ project, alerts }) => `<div class="dashboard-exposed reference-row-link" data-reference-project="${escapeHTML(project.slug)}" tabindex="0" role="link" aria-label="Ouvrir la fiche de ${escapeHTML(project.name)}"><span>${escapeHTML(project.name)}</span>${statusPill(alerts.some((alert) => alert.severity === 'Critique') ? 'red' : 'orange', `${alerts.length} alerte${alerts.length > 1 ? 's' : ''}`)}</div>`).join('')}
      </div></div></div>
      <div class="col-12 col-xl-4"><div class="card h-100"><div class="card-header">Exécution financière · projets suivis</div><div class="card-body">
        <div class="dashboard-stack" role="img" aria-label="Payé ${referencePercent(paidShare)}, engagé non payé ${referencePercent(unpaidShare)}, non engagé ${referencePercent(uncommittedShare)} de l’AE des projets suivis"><span class="stack-paid" style="width:${paidShare}%"></span><span class="stack-unpaid" style="width:${unpaidShare}%"></span><span class="stack-free" style="width:${uncommittedShare}%"></span></div>
        <ul class="dashboard-legend mt-3">
          <li><i class="dot-green"></i><span>Payé</span><strong>${referenceNumber(summary.totalPaid, 1)} Md DA</strong><em>${referencePercent(paidShare)}</em></li>
          <li><i class="dot-orange"></i><span>Engagé non payé</span><strong>${referenceNumber(summary.unpaidCommitments, 1)} Md DA</strong><em>${referencePercent(unpaidShare)}</em></li>
          <li><i class="dot-grey"></i><span>Non engagé</span><strong>${referenceNumber(summary.totalAe - summary.totalCommitted, 1)} Md DA</strong><em>${referencePercent(uncommittedShare)}</em></li>
        </ul>
        <p class="dashboard-note">Part de l’AE actuelle des ${summary.projectCount} projets suivis (${referenceNumber(summary.totalAe, 1)} Md DA).</p>
      </div></div></div>
    </div>`;
  return `${pageHeading('Tableau de bord · portefeuille CNED', 'Arbitrages, risques et exécution des projets suivis', '<button class="btn btn-outline-primary btn-sm" data-nav="map"><i class="bx bx-map me-1"></i>Carte nationale</button>')}
    ${statusStrip}
    <div class="reference-kpi-grid mb-4">
      ${[
        { label: 'AE · Portefeuille / Projets', valueHtml: `<span class="kpi-pair"><span class="kpi-pair-item"><strong>${referenceNumber(referenceSource.portfolioAe, 1)}</strong><small>Portefeuille · ${referenceSource.portfolioProjectCount} projets</small></span><span class="kpi-pair-sep" aria-hidden="true">/</span><span class="kpi-pair-item"><strong>${referenceNumber(summary.totalAe, 1)}</strong><small>Projets suivis · ${summary.projectCount}</small></span></span>`, unit: 'Md DA', note: `Les projets suivis représentent ${referencePercent(summary.portfolioShare)} de l’AE du portefeuille`, tone: 'blue', icon: 'bx-wallet', wide: true },
        { label: 'Payé · Projets suivis', value: referenceNumber(summary.totalPaid, 1), unit: 'Md DA', note: `${summary.projectCount} projets suivis · ${referencePercent(paidShare)} de leur AE`, tone: 'green', icon: 'bx-trending-up', ratio: paidShare },
        { label: 'Engagé non payé · Projets suivis', value: referenceNumber(summary.unpaidCommitments, 1), unit: 'Md DA', note: `${summary.projectCount} projets suivis · engagements moins paiements`, tone: 'amber', icon: 'bx-receipt' },
        { label: 'Avenants en attente', value: referenceNumber(summary.pendingAmendmentTotal, 3), unit: 'Md DA', note: `${summary.pendingAmendmentCount} dossiers · ${summary.pricedAmendmentCount} chiffrés · en attente d’approbation`, tone: pendingAmendments.some((amendment) => amendment.amount == null && /bloqué|reporté/i.test(amendment.status)) ? 'red' : 'amber', icon: 'bx-file' },
        { label: 'Factures en attente', value: '—', note: 'Non fourni par la source', tone: 'grey', icon: 'bx-time-five' }
      ].map(kpiTile).join('')}
    </div>
    ${analyticsRow}
    <div class="row g-4 mb-4">
      <div class="col-12 col-xl-6"><div class="card h-100"><div class="card-header">Avancement physique et financier · pondéré par l’AE</div><div class="card-body">
        ${weightedBars}
        <div class="reference-global-gap mt-3">${kpiTile({ label: 'Écart global', value: `${weightedGap >= 0 ? '+' : '−'}${referenceNumber(Math.abs(weightedGap), 1)}`, unit: 'pts', note: Math.abs(weightedGap) < 3 ? 'Quasi nul, mais masque de fortes disparités' : weightedGap > 0 ? 'Paiements au-delà des travaux' : 'Paiements en deçà des travaux', tone: Math.abs(weightedGap) < 3 ? 'amber' : 'red', icon: 'bx-transfer-alt' })}</div>
        <h6 class="reference-gap-heading mt-4">Écart par projet</h6>${progressBars}
        <div class="reference-gap-legend"><span><i class="ahead"></i>Paiements en avance</span><span><i class="behind"></i>Paiements en retard</span></div>
        <p class="reference-gap-formula">Écart = paiements sur travaux − avancement physique.</p>
      </div></div></div>
      <div class="col-12 col-xl-6"><div class="card h-100"><div class="card-header d-flex justify-content-between align-items-center"><span>Distribution territoriale · ${wilayas.length} wilayas</span><button class="btn btn-sm btn-link" data-nav="map">Ouvrir la carte</button></div><div class="card-body"><div class="leaflet-mini-map" data-leaflet-map="executive" data-map-mode="reference"></div><p class="small text-muted mt-2 mb-0">Points géographiques indicatifs ; aucune limite administrative n’est dessinée.</p></div></div></div>
    </div>
    <div class="card mb-4"><div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2"><span>Portefeuille suivi · ${summary.projectCount} projets</span><span class="small text-muted">Cliquez sur un projet pour ouvrir sa fiche</span></div><div class="table-responsive"><table class="table table-enterprise reference-headline-table"><thead><tr>
      <th scope="col">Projet / référence</th><th scope="col">Secteur</th><th scope="col">Wilaya(s)</th><th scope="col">Alertes</th><th scope="col">Écart</th><th scope="col">Délai</th><th scope="col">Observation</th>
    </tr></thead><tbody>${projectsTable}</tbody></table></div></div>
    <div class="card mb-4"><div class="card-header">Registre des alertes stratégiques</div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Priorité</th><th>Projet</th><th>Signal</th><th>Constat</th><th>Action recommandée</th></tr></thead><tbody>${alertRows}</tbody></table></div></div>
    <div class="row g-4 mb-4">
      <div class="col-12 col-xl-7"><div class="card h-100"><div class="card-header">Avenants et réévaluations en attente</div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Projet</th><th>Objet</th><th>Montant (Md DA)</th><th>Situation</th></tr></thead><tbody>${amendmentRows}<tr><td colspan="2"><strong>Total des montants chiffrés</strong></td><td class="text-end"><strong>${referenceNumber(summary.pendingAmendmentTotal)}</strong></td><td>${summary.unpricedAmendmentCount} dossiers sans montant · instruction en cours</td></tr></tbody></table></div></div></div>
      <div class="col-12 col-xl-5"><div class="card h-100"><div class="card-header">Actions et arbitrages recommandés</div><div class="card-body">${actions}</div></div></div>
    </div>`;
}

function roleDashboard() {
  if (['direction', 'pmo'].includes(roleKeyFor(state.user))) return referenceExecutiveDashboard();
  const scoped = allScopedProjects();
  const totalBudget = sum(scoped, (project) => project.budgetRevised);
  const delayed = scoped.filter((project) => ['En retard', 'À l’arrêt'].includes(project.status));
  const alertCount = currentInstances().filter((instance) => !['Résolue', 'Clôturée'].includes(state.alertChanges[instance.id]?.status || instance.status)).length;
  const pageHeader = pageHeading('Tableau de bord', `${role().intro} · ${shortDate('2026-11-13')}`, `<span class="role-chip"><i class="bx bx-shield-quarter"></i>${escapeHTML(role().workspace)}</span>`);
  let cards;
  let focus;
  let secondPanel;
  if (roleKeyFor(state.user) === 'direction') {
    const inProgress = scoped.filter((project) => project.status === 'En cours').length;
    const completed = scoped.filter((project) => project.status === 'Achevé').length;
    const physicalAverage = scoped.length ? Math.round(sum(scoped, (project) => project.physical) / scoped.length) : 0;
    const critical = scoped.filter((project) => project.status === 'À l’arrêt').length;
    cards = [
      metricCard('Projets au portefeuille', scoped.length, 'bx-buildings', 'National'),
      metricCard('AE actuelle portefeuille', money(totalBudget), 'bx-wallet', 'Md DA'),
      metricCard('Projets en cours', inProgress, 'bx-trending-up', 'National'),
      metricCard('Projets achevés', completed, 'bx-check-circle', 'National'),
      metricCard('Projets en retard / arrêt', delayed.length, 'bx-time-five', 'À arbitrer', 'DL3'),
      metricCard('Avancement physique moyen', `${physicalAverage} %`, 'bx-bar-chart-alt-2', 'National'),
      metricCard('Alertes ROUGE', currentInstances().filter((instance) => alertRule(instance.ruleId)?.Niveau === 'ROUGE').length, 'bx-error-circle', `${critical} sujets critiques`)
    ].join('');
    focus = `<div class="row g-4"><div class="col-xl-8"><div class="card h-100"><div class="card-header d-flex justify-content-between align-items-center"><span>Repères stratégiques du portefeuille</span><button class="btn btn-sm btn-label-primary" data-nav="kpis">Catalogue KPI</button></div><div class="card-body"><div class="row g-3">${['AV2', 'FI4', 'DL3', 'CO6'].map((id) => kpiMetric(id)).join('')}</div>${lineChart('Avancement physique consolidé · portefeuille illustratif', [42, 45, 49, 52, 55, 58])}</div></div></div><div class="col-xl-4"><div class="card h-100"><div class="card-header d-flex justify-content-between align-items-center"><span>Arbitrages prioritaires</span><span class="badge bg-label-danger">${critical}</span></div><div class="card-body"><div class="access-note mb-3">Lecture nationale · consultation seule. Les alertes sont des signaux d’aide à la décision, sans déclenchement automatique d’actes administratifs.</div>${latestAlertRows(4)}<button class="btn btn-sm btn-outline-secondary w-100 mt-3" data-nav="alerts">Ouvrir les alertes visibles</button></div></div></div></div>`;
    secondPanel = `<div class="row g-4 mt-0"><div class="col-xl-8"><div class="card"><div class="card-header d-flex justify-content-between align-items-center"><span>Projets nécessitant une attention institutionnelle</span><button class="btn btn-sm btn-link" data-nav="portfolio">Portefeuille national</button></div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Projet / référence</th><th>Wilaya</th><th>Avancement physique</th><th>AE actuelle</th><th>État</th></tr></thead><tbody>${smallProjectRows([...scoped].sort((a, b) => b.alertCount - a.alertCount), 5)}</tbody></table></div></div></div><div class="col-xl-4"><div class="card h-100"><div class="card-header">Répartition nationale · aperçu</div><div class="card-body"><div class="map-mini">${nationalMap(scoped, true)}</div><div class="d-flex justify-content-between mt-2"><span class="small text-muted">${scoped.length} projets · ${new Set(scoped.map((project) => project.wilaya)).size} wilayas</span><button class="btn btn-sm btn-link" data-nav="map">Carte détaillée</button></div></div></div></div></div>`;
  } else if (roleKeyFor(state.user) === 'pmo') {
    const red = currentInstances().filter((instance) => alertRule(instance.ruleId)?.Niveau === 'ROUGE').length;
    cards = [
      metricCard('Projets suivis', scoped.length, 'bx-buildings', 'National'),
      metricCard('AE actuelle', money(totalBudget), 'bx-wallet', 'Périmètre suivi'),
      metricCard('Alertes à traiter', alertCount, 'bx-bell', `${red} critiques`),
      metricCard('Données à vérifier', `${formatValue(kpiById('DO2'), portfolioValues.DO2)}`, 'bx-data', 'Complétude', 'DO2')
    ].join('');
    focus = `<div class="row g-4"><div class="col-xl-8"><div class="card"><div class="card-header d-flex justify-content-between align-items-center"><span>Performance & qualité des données</span><span class="badge bg-label-info">DO1 · DO2 · DO3</span></div><div class="card-body"><div class="row g-3">${['DO1', 'DO2', 'DO3', 'AV2'].map((id) => kpiMetric(id)).join('')}</div>${lineChart('Avancement consolidé · évolution illustrative', [43, 46, 48, 51, 56, 58])}</div></div></div><div class="col-xl-4"><div class="card h-100"><div class="card-header d-flex justify-content-between align-items-center"><span>Alertes actives</span><span class="badge bg-label-danger">${alertCount}</span></div><div class="card-body">${latestAlertRows(5)}<button class="btn btn-sm btn-outline-secondary w-100 mt-3" data-nav="alerts">Centre de traitement</button></div></div></div></div>`;
    secondPanel = `<div class="row g-4 mt-0"><div class="col-xl-8"><div class="card"><div class="card-header d-flex justify-content-between align-items-center"><span>Portefeuille national</span><button class="btn btn-sm btn-link" data-nav="portfolio">Tout voir</button></div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Projet / référence</th><th>Wilaya</th><th>Avancement</th><th>AE actuelle</th><th>État</th></tr></thead><tbody>${smallProjectRows(scoped, 5)}</tbody></table></div></div></div><div class="col-xl-4"><div class="card h-100"><div class="card-header">Qualité de la donnée</div><div class="card-body">${horizontalBars([{ label: 'Fraîcheur DO1', value: 76, display: '1,4×' }, { label: 'Complétude DO2', value: 82, display: '82 %' }, { label: 'Cohérence DO3', value: 86, display: '14 %' }])}<div class="access-note mt-3">Les alertes dont la donnée est insuffisante restent à vérifier avant diffusion.</div></div></div></div></div>`;
  } else if (roleKeyFor(state.user) === 'mo') {
    cards = [
      metricCard('Mes projets', scoped.length, 'bx-buildings', state.user.organization),
      metricCard('Avancement physique moyen', `${Math.round(sum(scoped, (project) => project.physical) / Math.max(scoped.length, 1))} %`, 'bx-trending-up', 'Projets attribués', 'AV1'),
      metricCard('Échéances à surveiller', scoped.filter((project) => new Date(project.forecast) > new Date(project.end)).length, 'bx-calendar-exclamation', 'Délai contractuel'),
      metricCard('Actions & alertes', alertCount, 'bx-bell', 'Dans mon périmètre')
    ].join('');
    focus = `<div class="row g-4"><div class="col-xl-8"><div class="card"><div class="card-header d-flex justify-content-between align-items-center"><span>Mes projets · suivi opérationnel</span><button class="btn btn-sm btn-primary" data-nav="field"><i class="bx bx-plus me-1"></i>Nouvelle situation terrain</button></div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Projet / référence</th><th>Wilaya</th><th>Avancement</th><th>Échéance</th><th>État</th></tr></thead><tbody>${smallProjectRows(scoped, 6)}</tbody></table></div></div></div><div class="col-xl-4"><div class="card h-100"><div class="card-header">Points de coordination</div><div class="card-body">${latestAlertRows(5)}<button class="btn btn-sm btn-outline-secondary w-100 mt-3" data-nav="alerts">Répondre aux alertes</button></div></div></div></div>`;
    secondPanel = `<div class="row g-4 mt-0"><div class="col-xl-6"><div class="card"><div class="card-header">Indicateurs de mes projets</div><div class="card-body"><div class="row g-3">${['AV1', 'DL1', 'QR1', 'GV1'].map((id) => kpiMetric(id)).join('')}</div></div></div></div><div class="col-xl-6"><div class="card"><div class="card-header">Actions à suivre</div><div class="card-body">${taskList(scoped)}</div></div></div></div>`;
  } else if (roleKeyFor(state.user) === 'bet') {
    cards = [
      metricCard('Projets contrôlés', scoped.length, 'bx-buildings', 'Affectations BET'),
      metricCard('Observations ouvertes', scoped.reduce((total, project) => total + (project.id === 'PRJ-2025-004' ? 3 : 1), 0), 'bx-search-alt', 'Technique'),
      metricCard('Non-conformités critiques', scoped.some((project) => project.values.QR7 > 30) ? 1 : 0, 'bx-error', 'Action requise', 'QR7'),
      metricCard('Réceptions à préparer', 2, 'bx-check-square', 'Suivi technique')
    ].join('');
    focus = `<div class="row g-4"><div class="col-xl-8"><div class="card"><div class="card-header d-flex justify-content-between align-items-center"><span>Suivi des projets contrôlés</span><button class="btn btn-sm btn-primary" data-nav="field"><i class="bx bx-plus me-1"></i>Rapport d’inspection</button></div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Projet / marché</th><th>Wilaya</th><th>Avancement</th><th>Observation ouverte</th><th>État</th></tr></thead><tbody>${smallProjectRows(scoped, 6)}</tbody></table></div></div></div><div class="col-xl-4"><div class="card h-100"><div class="card-header">Qualité & contrôle</div><div class="card-body"><div class="row g-3">${['QR7', 'QR6', 'QR8'].map((id) => kpiMetric(id)).join('')}</div>${latestAlertRows(3)}</div></div></div></div>`;
    secondPanel = `<div class="row g-4 mt-0"><div class="col-xl-6"><div class="card"><div class="card-header">Non-conformités & actions correctives</div><div class="card-body">${taskList(scoped, true)}</div></div></div><div class="col-xl-6"><div class="card"><div class="card-header">Planning de réception</div><div class="card-body">${lineChart('Réserves levées · suivi illustratif', [31, 39, 43, 58, 64, 71])}</div></div></div></div>`;
  } else if (roleKeyFor(state.user) === 'contractor') {
    const physical = Math.round(sum(scoped, (project) => project.physical) / Math.max(scoped.length, 1));
    const ownScore = scoped.length ? Math.round(sum(scoped, (project) => Number(project.values.CO1 || 65)) / scoped.length) : 0;
    cards = [
      metricCard('Mes contrats', scoped.length, 'bx-briefcase', 'Périmètre entreprise'),
      metricCard('Avancement déclaré', `${physical} %`, 'bx-trending-up', 'Chantiers affectés'),
      metricCard('Mobilisation effective', `${formatValue(kpiById('PP2'), scoped[0]?.values.PP2 ?? portfolioValues.PP2)}`, 'bx-wrench', 'PP2', 'PP2'),
      metricCard('Ma santé contractant', `${ownScore} / 100`, 'bx-check-shield', 'CO1 · mes marchés', 'CO1')
    ].join('');
    focus = `<div class="row g-4"><div class="col-xl-8"><div class="card"><div class="card-header d-flex justify-content-between align-items-center"><span>Mes chantiers & livrables</span><button class="btn btn-sm btn-primary" data-nav="field"><i class="bx bx-upload me-1"></i>Déclarer l’avancement</button></div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Contrat / projet</th><th>Wilaya</th><th>Avancement</th><th>Prochaine étape</th><th>État</th></tr></thead><tbody>${smallProjectRows(scoped, 6)}</tbody></table></div></div></div><div class="col-xl-4"><div class="card h-100"><div class="card-header">Observations à traiter</div><div class="card-body">${latestAlertRows(4)}<button class="btn btn-sm btn-outline-secondary w-100 mt-3" data-nav="messages">Échanger avec l’équipe projet</button></div></div></div></div>`;
    secondPanel = `<div class="row g-4 mt-0"><div class="col-xl-6"><div class="card"><div class="card-header">Planning hebdomadaire</div><div class="card-body">${taskList(scoped)}<button class="btn btn-sm btn-outline-primary mt-2" data-nav="planning">Consulter les jalons</button></div></div></div><div class="col-xl-6"><div class="card"><div class="card-header">Vos indicateurs contractuels uniquement</div><div class="card-body"><div class="access-note mb-3">Les scores et données d’autres entreprises ne sont pas accessibles.</div><div class="row g-3">${['CO1', 'PP1', 'PP2', 'FI6'].map((id) => kpiMetric(id)).join('')}</div></div></div></div></div>`;
  } else {
    const initial = sum(scoped, (project) => project.budgetInitial);
    const revised = sum(scoped, (project) => project.budgetRevised);
    cards = [
      metricCard('Projets du périmètre financier', scoped.length, 'bx-buildings', 'Accès budgétaire attribué'),
      metricCard('AE initiale', money(initial), 'bx-wallet', 'Périmètre suivi'),
      metricCard('AE actuelle', money(revised), 'bx-transfer-alt', 'Révisée', 'FI4'),
      metricCard('Situations à surveiller', currentInstances().filter((instance) => ['AL03', 'AL08', 'AL11'].includes(instance.ruleId)).length, 'bx-time-five', 'Alertes financières')
    ].join('');
    focus = `<div class="row g-4"><div class="col-xl-8"><div class="card"><div class="card-header d-flex justify-content-between align-items-center"><span>Exécution budgétaire · périmètre attribué</span><button class="btn btn-sm btn-link" data-nav="finance">Détail financier</button></div><div class="card-body">${horizontalBars([{ label: 'AE initiale', value: initial, display: money(initial) }, { label: 'AE actuelle', value: revised, display: money(revised) }, { label: 'Paiements exécutés', value: revised * 0.46, display: money(revised * 0.46) }, { label: 'Engagements', value: revised * 0.72, display: money(revised * 0.72) }])}${lineChart('Crédits de paiement & règlements · illustratif', [38, 42, 40, 48, 53, 61])}</div></div></div><div class="col-xl-4"><div class="card h-100"><div class="card-header">Alertes financières</div><div class="card-body">${latestAlertRows(5)}<button class="btn btn-sm btn-outline-secondary w-100 mt-3" data-nav="alerts">Ouvrir les alertes financières</button></div></div></div></div>`;
    secondPanel = `<div class="row g-4 mt-0"><div class="col-xl-8"><div class="card"><div class="card-header">Projets du périmètre financier</div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Projet / référence</th><th>Wilaya</th><th>AE actuelle</th><th>Progression financière</th><th>État</th></tr></thead><tbody>${smallProjectRows(scoped, 5)}</tbody></table></div></div></div><div class="col-xl-4"><div class="card"><div class="card-header">Repères financiers</div><div class="card-body"><div class="row g-3">${['FI1', 'FI3', 'FI4', 'FI5'].map((id) => kpiMetric(id)).join('')}</div></div></div></div></div>`;
  }
  return `${pageHeader}${demoBanner()}<div class="row g-4 mb-4">${cards}</div>${focus}${secondPanel}`;
}

const referenceFact = (label, value, note = '') => `<div class="project-fact"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value == null || value === '' ? 'Information indisponible' : value)}</strong>${note ? `<small class="text-muted">${escapeHTML(note)}</small>` : ''}</div>`;
const referenceProgress = (label, value, suffix = '%') => `<div class="reference-lot-progress"><div class="d-flex justify-content-between gap-2"><strong>${escapeHTML(label)}</strong><span>${escapeHTML(`${referenceNumber(value, 1)} ${suffix}`)}</span></div><div class="progress"><div class="progress-bar" role="progressbar" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="100" style="width:${Math.max(0, Math.min(100, value))}%"></div></div></div>`;

function referencePmoPage() {
  const project = referenceProjectBySlug(state.referenceProjectId) || referenceProjectBySlug('djendjen');
  if (!project) return '<div class="empty-state">La fiche de référence n’est pas disponible.</div>';
  const aeRatio = project.aeCurrent / project.aeInitial;
  const durationRatio = project.currentDurationMonths / project.initialDurationMonths;
  const remainingDuration = project.currentDurationMonths * (1 - project.timeConsumed / 100);
  const observedCadence = project.physical / (project.currentDurationMonths * project.timeConsumed / 100);
  const requiredCadence = (100 - project.physical) / remainingDuration;
  const tabs = [
    ['synthese', 'Synthèse'], ['technique', 'Avancement technique'], ['chantier', 'Données de chantier'],
    ['contrats', 'Marchés & contrats'], ['finances', 'Suivi financier'], ['delais', 'Délais & planning'],
    ['risques', 'Blocages & risques'], ['kpi', 'KPI & Alertes'], ['documents', 'Documents'],
    ['discussions', 'Discussions'], ['historique', 'Historique']
  ];
  const nav = `<div class="reference-tabs" role="tablist">${tabs.map(([id, label]) => `<button type="button" class="${state.referenceProjectTab === id ? 'active' : ''}" data-reference-project-tab="${id}" role="tab" aria-selected="${state.referenceProjectTab === id}">${escapeHTML(label)}</button>`).join('')}</div>`;
  let content = '';
  if (state.referenceProjectTab === 'synthese') {
    content = `<div class="row g-3 mb-4">${[
      { label: 'Avancement physique', value: referencePercent(project.physical, 2), note: 'Travaux exécutés', tone: 'amber', icon: 'bx-trending-up', ratio: project.physical },
      { label: 'Avancement financier', value: referencePercent(project.financial, 2), note: 'Paiements sur le marché travaux', tone: 'green', icon: 'bx-wallet', ratio: project.financial },
      { label: 'Délai consommé', value: referencePercent(project.timeConsumed, 2), note: 'Durée contractuelle', tone: project.timeConsumed >= 100 ? 'red' : 'amber', icon: 'bx-time-five', ratio: project.timeConsumed },
      { label: 'Complétude terrain', value: 'À compléter', note: 'Données opérationnelles à fournir / valider', tone: 'grey', icon: 'bx-map-pin' },
      { label: 'AE actuelle', value: referenceNumber(project.aeCurrent), unit: 'Md DA', note: project.aeInitial == null ? 'AE initiale indisponible' : `AE initiale : ${referenceNumber(project.aeInitial)} Md DA`, tone: 'blue', icon: 'bx-wallet' },
      { label: 'Engagé / payé', value: `${referenceNumber(project.committed)} / ${referenceNumber(project.paid)}`, unit: 'Md DA', note: 'Engagements et paiements cumulés', tone: 'green', icon: 'bx-receipt' },
      { label: 'Avenant en attente', value: referenceNumber(project.pendingAmendment), unit: 'Md DA', note: 'Approbation requise', tone: 'amber', icon: 'bx-file' }
    ].map((item) => `<div class="col-12 col-sm-6 col-xl-4">${kpiTile(item)}</div>`).join('')}</div>
    <div class="row g-4"><div class="col-12 col-xl-7"><div class="card h-100"><div class="card-header">Synthèse décisionnelle du projet</div><div class="card-body">
      <div class="reference-decision-banner compact"><h6>Le délai consommé (${referenceNumber(project.timeConsumed, 0)} %) dépasse l’avancement physique (${referenceNumber(project.physical, 0)} %) de ${referenceNumber(project.timeConsumed - project.physical, 0)} points.</h6><p>Le rythme requis pour achever les travaux est d’environ ${referenceNumber(requiredCadence, 2)} points par mois contre ${referenceNumber(observedCadence, 2)} observé. La source signale des emprises et réseaux non achevés ; le périmètre et le coût de la section PK 34–38 nécessitent un arbitrage.</p></div>
      ${referenceFact('Constat CNED', project.observation)}
      ${referenceFact('Recommandation CNED', project.recommendation)}
      <div class="mt-3"><div class="leaflet-mini-map" data-leaflet-map="pmo-project" data-map-mode="project" data-project-slug="${project.slug}"></div><small class="text-muted">Point de référence fourni dans la fiche ; tracé linéaire non disponible.</small></div>
    </div></div></div><div class="col-12 col-xl-5"><div class="card h-100"><div class="card-header">Acteurs du projet</div><div class="card-body">
      ${referenceFact('Maître d’ouvrage', 'À renseigner')}
      ${referenceFact('Bureau d’études (BET)', project.bet)}
      ${referenceFact('Organisme de contrôle', 'À renseigner')}
      ${referenceFact('Bureau de contrôle et suivi (BCS)', project.control)}
      ${referenceFact('Contractant', project.contractor)}
      <div class="access-note mt-3">Les organismes sont repris de la synthèse CNED. Aucun nom de responsable individuel n’est fourni.</div>
    </div></div></div></div>`;
  } else if (state.referenceProjectTab === 'technique') {
    content = `<div class="row g-4"><div class="col-12 col-xl-7"><div class="card"><div class="card-header">Avancement technique par lot · référence CNED</div><div class="card-body">${djendjenTechnicalLots.map((lot) => referenceProgress(lot.name, lot.progress)).join('')}${referenceProgress('Avancement global', project.physical)}</div></div></div>
      <div class="col-12 col-xl-5"><div class="card"><div class="card-header">Lecture technique</div><div class="card-body">${referenceFact('Point d’attention', 'Libération des emprises et déplacement des réseaux non achevés.')}${referenceFact('Section PK 34–38', 'Consistance et coût à arrêter.')}${referenceFact('Observations détaillées de lot', 'À renseigner / à valider par le maître d’ouvrage.')}</div></div></div></div>`;
  } else if (state.referenceProjectTab === 'chantier') {
    content = `<div class="card mb-4"><div class="card-header">Données opérationnelles et suivi terrain</div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Groupe</th><th>Donnée attendue</th><th>État de la donnée</th><th>Valeur / prochaine action</th></tr></thead><tbody>${djendjenOperationalFields.map((field) => {
      const update = state.referenceOperationalUpdates[`${project.slug}:${field.name}`];
      return `<tr><td>${escapeHTML(field.group)}</td><td class="primary-cell">${escapeHTML(field.name)}</td><td>${statusPill(update ? 'orange' : field.status === 'Arbitrage requis' ? 'red' : field.status === 'À valider' ? 'orange' : 'info', update ? 'Saisie locale · à valider' : field.status)}</td><td>${update ? escapeHTML(update.value) : field.group === 'Section PK 34–38' ? escapeHTML(project.recommendation) : 'À fournir par le maître d’ouvrage'}</td></tr>`;
    }).join('')}</tbody></table></div><div class="card-body"><div class="access-note">Les valeurs issues de la synthèse CNED restent immuables. Toute saisie ci-dessous est locale au navigateur et porte le statut « à valider » jusqu’à confirmation institutionnelle.</div></div></div>
    <div class="card"><div class="card-header">Déclarer une donnée de chantier · saisie de démonstration</div><div class="card-body"><form data-form="reference-field-update">
      <label class="form-label" for="reference-field-name">Donnée à actualiser</label><select class="form-select" id="reference-field-name" name="field" required>${djendjenOperationalFields.map((field) => `<option value="${escapeHTML(field.name)}">${escapeHTML(field.group)} · ${escapeHTML(field.name)}</option>`).join('')}</select>
      <label class="form-label mt-3" for="reference-field-value">Valeur déclarée</label><textarea class="form-control" id="reference-field-value" name="value" rows="3" maxlength="1000" required></textarea>
      <button class="btn btn-primary mt-3" type="submit">Enregistrer pour validation</button>
    </form></div></div>`;
  } else if (state.referenceProjectTab === 'contrats') {
    content = `<div class="row g-4"><div class="col-12 col-xl-6"><div class="card"><div class="card-header">Marché de travaux et ordres de service</div><div class="card-body">
      ${referenceFact('Procédure de passation', 'Information indisponible')}
      ${referenceFact('Numéro de marché', 'Information indisponible')}
      ${referenceFact('Ordre de service de démarrage', project.startDate)}
      ${referenceFact('Durée initiale', `${project.initialDurationMonths} mois`)}
      ${referenceFact('Durée en vigueur', `${project.currentDurationMonths} mois`)}
      ${referenceFact('Fin contractuelle', project.contractualEnd)}
      ${referenceFact('Titulaire / groupement', project.contractor)}
      ${referenceFact('Substitution', 'ETRHB remplacé par MAPA (selon la fiche CNED)')}
    </div></div></div><div class="col-12 col-xl-6"><div class="card"><div class="card-header">Avenants, garanties et réception</div><div class="card-body">
      ${referenceFact('Avenant n°14 travaux', 'En attente · montant indiqué dans la source avec le contrôle')}
      ${referenceFact('Avenant n°08 contrôle', 'En attente · montant indiqué dans la source avec les travaux')}
      ${referenceFact('Montant en attente', `${referenceNumber(project.pendingAmendment)} Md DA`)}
      ${referenceFact('Ordres d’arrêt et de reprise', 'Information indisponible')}
      ${referenceFact('Garantie de bonne exécution / assurances', 'Information indisponible')}
      ${referenceFact('Prolongations légitimes / retards imputables', 'À instruire')}
      ${referenceFact('Mises en demeure, réclamations et litiges', 'Information indisponible')}
      ${referenceFact('Réceptions partielles et justificatifs', 'Information indisponible')}
    </div></div></div></div>`;
  } else if (state.referenceProjectTab === 'finances') {
    content = `<div class="row g-4"><div class="col-12 col-xl-6"><div class="card"><div class="card-header">Autorisations d’engagement et exécution</div><div class="card-body">
      ${referenceFact('AE initiale', `${referenceNumber(project.aeInitial)} Md DA`)}
      ${referenceFact('AE actuelle', `${referenceNumber(project.aeCurrent)} Md DA`)}
      ${referenceFact('Évolution de l’AE', `× ${referenceNumber(aeRatio, 2)} depuis l’inscription`)}
      ${referenceFact('Engagements cumulés', `${referenceNumber(project.committed)} Md DA`)}
      ${referenceFact('Paiements cumulés', `${referenceNumber(project.paid)} Md DA`)}
      ${referenceFact('Engagé non payé', `${referenceNumber(project.committed - project.paid)} Md DA`)}
      ${referenceFact('Réévaluation / avenant en attente', `${referenceNumber(project.pendingAmendment)} Md DA`)}
    </div></div></div><div class="col-12 col-xl-6"><div class="card"><div class="card-header">Marchés, situations et paiements</div><div class="card-body">
      ${referenceFact('Marché travaux après avenants', `${referenceNumber(project.worksContract)} Md DA`)}
      ${referenceFact('Paiements travaux', `${referenceNumber(project.paid)} Md DA`)}
      ${referenceFact('Marché et paiements de contrôle / suivi', 'Information indisponible')}
      ${referenceFact('Marché d’études', 'Information indisponible')}
      ${referenceFact('Situations de travaux en attente', 'Information indisponible')}
      ${referenceFact('Délai moyen de paiement / révisions de prix', 'Information indisponible')}
      ${referenceFact('Pertes de change / crédits de paiement', 'Information indisponible')}
      ${referenceFact('Avances à récupérer', 'Information indisponible')}
    </div></div></div></div>`;
  } else if (state.referenceProjectTab === 'delais') {
    content = `<div class="row g-3 mb-4">${[
      ['Durée initiale', `${project.initialDurationMonths} mois`],
      ['Durée en vigueur', `${referenceNumber(project.currentDurationMonths, 1)} mois · × ${referenceNumber(durationRatio, 2)}`],
      ['Délai consommé', `${referenceNumber(project.timeConsumed, 2)} %`],
      ['Fin contractuelle', project.contractualEnd]
    ].map(([label, value]) => `<div class="col-12 col-sm-6 col-xl-3"><div class="card reference-kpi-card h-100"><div class="card-body"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div></div></div>`).join('')}</div>
    <div class="card"><div class="card-header">Cadence nécessaire pour terminer</div><div class="card-body">
      ${referenceProgress('Délai consommé', project.timeConsumed)}
      ${referenceProgress('Avancement physique', project.physical)}
      ${referenceFact('Cadence observée', `${referenceNumber(observedCadence, 2)} points d’avancement / mois`)}
      ${referenceFact('Cadence requise', `${referenceNumber(requiredCadence, 2)} points d’avancement / mois`)}
      ${referenceFact('Rapport requis / observé', `× ${referenceNumber(requiredCadence / observedCadence, 2)}`)}
      <div class="access-note mt-3">Calcul repris de la logique de la fiche de référence : le temps restant est la durée en vigueur × (1 − délai consommé). Cette projection est indicative et ne remplace pas un planning actualisé.</div>
    </div></div>`;
  } else if (state.referenceProjectTab === 'risques') {
    const alerts = [
      { title: `Dérive de l’AE : × ${referenceNumber(aeRatio, 2)}`, explanation: 'L’AE actuelle de 214,375 Md DA dépasse l’AE initiale de 90 Md DA.', action: 'Examiner la consistance et les réévaluations successives.' },
      { title: `Durée en vigueur : × ${referenceNumber(durationRatio, 2)} la durée initiale`, explanation: '138 mois en vigueur contre 36 mois initiaux.', action: 'Vérifier les prolongations et leur part légitime.' },
      { title: `Délai consommé supérieur de ${referenceNumber(project.timeConsumed - project.physical, 0)} points à l’avancement`, explanation: '91 % du délai consommé pour 62 % d’avancement physique.', action: 'Mettre à jour le planning et identifier les blocages institutionnels.' },
      { title: `Cadence requise : × ${referenceNumber(requiredCadence / observedCadence, 2)} la cadence observée`, explanation: `${referenceNumber(requiredCadence, 2)} points par mois requis contre ${referenceNumber(observedCadence, 2)} observé.`, action: 'Réviser le plan de mobilisation et suivre les engagements.' },
      { title: `Réévaluation en attente : ${referenceNumber(project.pendingAmendment)} Md DA`, explanation: 'Avenant n°14 travaux et n°08 contrôle dans l’attente d’approbation.', action: 'Obtenir l’approbation ou fixer une date limite.' }
    ];
    content = `<div class="card"><div class="card-header">Alertes du projet</div><div class="card-body">${alerts.map((alert) => `<article class="reference-alert"><div>${statusPill('red', 'À arbitrer')}</div><div><strong>${escapeHTML(alert.title)}</strong><p>${escapeHTML(alert.explanation)}</p><small><b>Action :</b> ${escapeHTML(alert.action)}</small></div></article>`).join('')}
      <h6 class="mt-4">Blocages opérationnels signalés</h6><p>${escapeHTML(project.observation)}</p><p class="mb-0"><strong>Recommandation :</strong> ${escapeHTML(project.recommendation)}</p>
    </div></div>`;
  } else if (state.referenceProjectTab === 'kpi') {
    content = `<div class="card"><div class="card-header">Indicateurs utiles à la décision</div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Indicateur</th><th>Valeur</th><th>État</th><th>Action / responsable</th></tr></thead><tbody>
      <tr><td>Avancement physique</td><td>62 %</td><td>${statusPill('orange', 'À surveiller')}</td><td>Cadence chantier · maître d’ouvrage</td></tr>
      <tr><td>Avancement financier</td><td>61,32 %</td><td>${statusPill('green', 'Proche du physique')}</td><td>Suivre le rapprochement des situations</td></tr>
      <tr><td>Évolution de l’AE</td><td>× ${referenceNumber(aeRatio, 2)}</td><td>${statusPill('red', 'Critique')}</td><td>Arbitrage sur la consistance · autorité compétente</td></tr>
      <tr><td>Dérive du délai</td><td>× ${referenceNumber(durationRatio, 2)}</td><td>${statusPill('red', 'Critique')}</td><td>Vérifier les prolongations légitimes</td></tr>
      <tr><td>Cadence requise / observée</td><td>× ${referenceNumber(requiredCadence / observedCadence, 2)}</td><td>${statusPill('red', 'Critique')}</td><td>Actualiser le planning et le plan de mobilisation</td></tr>
      <tr><td>Réévaluation en attente</td><td>${referenceNumber(project.pendingAmendment)} Md DA</td><td>${statusPill('orange', 'Important')}</td><td>Obtenir l’approbation · parties compétentes</td></tr>
    </tbody></table></div></div>`;
  } else if (state.referenceProjectTab === 'documents') {
    content = `<div class="card"><div class="card-header">Documents et pièces justificatives</div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Pièce</th><th>Situation</th><th>Source / action</th></tr></thead><tbody>
      <tr><td>Rapport de synthèse CNED</td><td>${statusPill('green', 'Disponible')}</td><td>Septembre 2025</td></tr>
      ${['Marché de travaux et avenants signés', 'Ordres de service d’arrêt / reprise', 'Garanties et polices d’assurance', 'Situations de travaux et paiements', 'Procès-verbaux de réception', 'Photos de terrain géolocalisées'].map((name) => `<tr><td>${escapeHTML(name)}</td><td>${statusPill('info', 'À téléverser')}</td><td>Information indisponible dans la synthèse</td></tr>`).join('')}
    </tbody></table></div><div class="card-body"><div class="access-note">Les pièces absentes ne sont pas simulées. Les déposer dans l’espace documentaire du prototype reste une action locale de démonstration.</div><button class="btn btn-outline-primary btn-sm mt-3" data-nav="documents">Ouvrir les documents</button></div></div>`;
  } else if (state.referenceProjectTab === 'discussions') {
    content = `<div class="row g-4"><div class="col-12 col-xl-7"><div class="card"><div class="card-header">Actions de coordination tirées de la recommandation CNED</div><div class="card-body">
      ${referenceFact('Emprises restantes', 'Coordonner avec autorités locales et gestionnaires de réseaux.')}
      ${referenceFact('Section PK 34–38', 'Arrêter la consistance et le coût.')}
      ${referenceFact('Responsables et échéances', 'À désigner par les parties compétentes.')}
    </div></div></div><div class="col-12 col-xl-5"><div class="card"><div class="card-header">Communication de projet</div><div class="card-body"><p>Les échanges disponibles dans la plateforme restent des données locales de démonstration.</p><button class="btn btn-primary" data-nav="messages">Ouvrir la communication</button></div></div></div></div>`;
  } else {
    content = `<div class="card"><div class="card-header">Historique et traçabilité</div><div class="card-body">
      ${referenceFact('Date de démarrage', project.startDate)}
    </div></div>`;
  }
  return `${pageHeading(project.name, `${project.id} · ${project.sector} · ${project.wilayas.join(', ')}`, '<button class="btn btn-outline-primary btn-sm" data-nav="dashboard"><i class="bx bx-arrow-back me-1"></i>Vision Direction</button>')}
    <div class="card mb-4"><div class="card-body pb-3"><div class="d-flex flex-wrap justify-content-between align-items-start gap-3"><div><span class="text-muted small">${escapeHTML(project.id)} · ${escapeHTML(project.sector)}</span><h5 class="mb-1">${escapeHTML(project.name)}</h5><span class="text-muted small">${escapeHTML(project.wilayas.join(', '))} · fin contractuelle : ${escapeHTML(project.contractualEnd)}</span></div>${referenceStatusBadge(project)}</div>
      ${nav}<div class="pt-4">${content}</div>
    </div></div>`;
}

function referenceProjectDetailPage() {
  const project = referenceProjectBySlug(state.referenceProjectId);
  if (!project) return '<div class="empty-state">La fiche de référence n’est pas disponible.</div>';
  if (project.slug === 'djendjen') return referencePmoPage();
  const fields = [
    ['Référence', project.id], ['Secteur', project.sector], ['Wilaya(s)', project.wilayas.join(', ')],
    ['Coordonnées (latitude, longitude)', project.coordinates.join(', ')], ['AE initiale', `${referenceNumber(project.aeInitial)} Md DA`],
    ['AE actuelle', `${referenceNumber(project.aeCurrent)} Md DA`], ['Engagements', `${referenceNumber(project.committed)} Md DA`],
    ['Paiements', `${referenceNumber(project.paid)} Md DA`], ['Avancement physique', `${referenceNumber(project.physical, 2)} %`],
    ['Avancement financier', `${referenceNumber(project.financial, 2)} %`], ['Délai consommé', `${referenceNumber(project.timeConsumed, 2)} %`],
    ['Date de démarrage', project.startDate], ['Durée initiale', `${project.initialDurationMonths} mois`],
    ['Durée en vigueur', `${referenceNumber(project.currentDurationMonths, 1)} mois`], ['Fin contractuelle', project.contractualEnd],
    ['Marché travaux', `${referenceNumber(project.worksContract)} Md DA`],
    ['Avenant / réévaluation en attente', `${referenceNumber(project.pendingAmendment)} Md DA`],
    ['Contractant', project.contractor], ['BET', project.bet], ['Contrôle / BCS', project.control]
  ];
  return `${pageHeading(project.name, `${project.id} · ${project.sector} · ${project.wilayas.join(', ')}`, '<button class="btn btn-outline-secondary btn-sm" data-nav="dashboard"><i class="bx bx-arrow-back me-1"></i>Retour</button>')}
    <div class="row g-4"><div class="col-12 col-xl-8"><div class="card"><div class="card-header">Données de la fiche projet</div><div class="card-body"><div class="row g-3">${fields.map(([label, value]) => `<div class="col-12 col-sm-6">${referenceFact(label, value)}</div>`).join('')}</div>
      <div class="reference-decision-banner compact mt-4"><h6>Constat CNED</h6><p>${escapeHTML(project.observation)}</p><strong>Recommandation :</strong> ${escapeHTML(project.recommendation)}</div>
    </div></div></div><div class="col-12 col-xl-4"><div class="card"><div class="card-header">État et localisation</div><div class="card-body">${referenceStatusBadge(project)}<p class="mt-3">${escapeHTML(project.wilayas.join(', '))}</p><div class="leaflet-mini-map" data-leaflet-map="reference-detail" data-map-mode="project" data-project-slug="${project.slug}"></div><small class="text-muted">Point indicatif de la fiche source ; aucun tracé de l’infrastructure n’est fourni.</small><button class="btn btn-primary w-100 mt-3" data-nav="map">Voir la carte nationale</button></div></div></div></div>`;
}

function referenceAlertRegister() {
  const rows = referenceProjects.flatMap((project) => referenceAlerts(project).map((alert) => `<tr>
    <td>${statusPill(alert.severity === 'Critique' ? 'red' : 'orange', alert.severity)}</td>
    <td><button class="btn btn-link p-0 text-start table-project-name" data-reference-project="${project.slug}">${escapeHTML(project.name)}</button><span class="table-project-meta">${escapeHTML(project.id)}</span></td>
    <td>${escapeHTML(alert.title)}</td><td>${escapeHTML(project.observation)}</td><td>${escapeHTML(alert.action)}</td>
  </tr>`)).join('');
  return `<div class="card mt-4"><div class="card-header">Alertes des projets suivis</div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Priorité</th><th>Projet</th><th>Signal</th><th>Constat source</th><th>Action recommandée</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function kpiMetric(id) {
  const item = kpiById(id);
  if (!item || !rolePermission('kpis', id)) return '';
  const value = valueFor(item);
  const status = statusFor(item, value);
  return `<div class="col-6"><button class="kpi-summary-card text-start w-100" data-kpi-id="${id}"><span class="d-flex align-items-center justify-content-between gap-2"><span class="kpi-id">${id}</span>${statusPill(status, statusNames[status])}</span><strong>${escapeHTML(formatValue(item, value))}</strong><span>${escapeHTML(item.Nom_KPI)}</span></button></div>`;
}

function taskList(scoped = allScopedProjects(), technical = false) {
  const tasks = technical
    ? [{ label: 'Lever la non-conformité critique · bibliothèque centrale', due: '14 nov.', status: 'À vérifier' }, { label: 'Valider les réservations techniques', due: '18 nov.', status: 'En cours' }, { label: 'Préparer la réception partielle', due: '25 nov.', status: 'Planifiée' }]
    : [{ label: `Confirmer le plan d’action · ${scoped[0]?.shortName || 'projet affecté'}`, due: '14 nov.', status: 'Prioritaire' }, { label: 'Mettre à jour le point de situation mensuel', due: '18 nov.', status: 'À compléter' }, { label: 'Préparer la revue de jalons', due: '24 nov.', status: 'Planifiée' }];
  return tasks.map((task) => `<div class="d-flex align-items-center justify-content-between gap-2 border-bottom py-2"><span class="small text-muted">${escapeHTML(task.label)}</span><span class="text-nowrap small d-inline-flex align-items-center gap-2">${escapeHTML(task.due)} ${statusPill(taskTone(task.status), task.status)}</span></div>`).join('');
}

function referencePortfolioPage() {
  const query = state.referencePortfolioQuery.trim().toLocaleLowerCase('fr');
  const filtered = referenceProjects.filter((project) => {
    const matchesQuery = !query || [project.id, project.name, project.sector, ...project.wilayas].join(' ').toLocaleLowerCase('fr').includes(query);
    const matchesStatus = !state.referencePortfolioStatus || referenceStatus(project) === state.referencePortfolioStatus;
    return matchesQuery && matchesStatus;
  });
  const statuses = [
    ['', 'Tous'],
    ['À l’arrêt', 'À l’arrêt'],
    ['En retard', 'En retard'],
    ['À surveiller', 'À surveiller']
  ];
  const rows = filtered.map((project) => {
    const gap = project.financial - project.physical;
    return `<tr class="reference-row-link" data-reference-project="${escapeHTML(project.slug)}" tabindex="0" role="link" aria-label="Ouvrir la fiche de ${escapeHTML(project.name)}">
      <td>${escapeHTML(project.id)}</td>
      <td><strong>${escapeHTML(project.name)}</strong></td>
      <td>${escapeHTML(project.sector)}</td>
      <td>${escapeHTML(project.wilayas.join(', '))}</td>
      <td class="text-end reference-number-cell">${referenceNumber(project.aeCurrent, 1)}</td>
      <td class="text-end reference-number-cell">${referencePercent(project.physical)}</td>
      <td class="text-end reference-number-cell">${referencePercent(project.financial)}</td>
      <td class="text-end reference-number-cell"><strong class="reference-gap-value ${gap > 0 ? 'ahead' : 'behind'}">${gap > 0 ? '+' : '−'}${referenceNumber(Math.abs(gap), 0)}</strong></td>
      <td>${referenceStatusBadge(project)}</td>
    </tr>`;
  }).join('');
  return `${pageHeading('Portefeuille de projets', 'Fiche technique de chaque projet.', '<button class="btn btn-outline-secondary btn-sm" data-export="projects"><i class="bx bx-download me-1"></i>Exporter CSV</button>')}
    <div class="card">
      <div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-3">
        <div><strong>Projets suivis</strong><span class="text-muted small ms-2">${filtered.length} / ${referenceProjects.length}</span></div>
        <form class="reference-portfolio-search" data-form="reference-portfolio-search">
          <label class="visually-hidden" for="reference-portfolio-query">Rechercher un projet</label>
          <input class="form-control form-control-sm" id="reference-portfolio-query" name="query" value="${escapeHTML(state.referencePortfolioQuery)}" placeholder="Rechercher un projet…" aria-label="Rechercher un projet">
          <button class="btn btn-sm btn-outline-primary" type="submit">Rechercher</button>
        </form>
        <div class="reference-status-chips" role="group" aria-label="Filtrer par état">
          ${statuses.map(([value, label]) => `<button class="btn btn-sm ${state.referencePortfolioStatus === value ? 'btn-primary' : 'btn-outline-secondary'}" type="button" data-reference-portfolio-status="${escapeHTML(value)}" aria-pressed="${state.referencePortfolioStatus === value}">${escapeHTML(label)}</button>`).join('')}
        </div>
      </div>
      <div class="table-responsive"><table class="table table-enterprise reference-portfolio-table"><thead><tr>
        <th scope="col">Référence</th><th scope="col">Projet</th><th scope="col">Secteur</th><th scope="col">Wilaya</th><th scope="col" class="text-end">AE (Md DA)</th><th scope="col" class="text-end">Physique</th><th scope="col" class="text-end">Financier</th><th scope="col" class="text-end">Écart</th><th scope="col">État</th>
      </tr></thead><tbody>${rows || `<tr><td colspan="9"><div class="empty-state">Aucun projet ne correspond aux filtres.</div></td></tr>`}</tbody></table></div>
      <div class="reference-portfolio-footnote">Codification des références proposée (secteur et numéro d'ordre). Cliquez sur un projet pour ouvrir sa fiche.</div>
    </div>`;
}

function portfolioPage() {
  if (['direction', 'pmo'].includes(roleKeyFor(state.user))) return referencePortfolioPage();
  const items = allScopedProjects();
  const query = state.globalSearch.trim().toLowerCase();
  const filtered = items.filter((project) => (!query || [project.name, project.id, project.wilaya, project.sector].join(' ').toLowerCase().includes(query)) && (!state.projectStatus || project.status === state.projectStatus));
  const sortBy = ['name', 'wilaya', 'budget', 'progress', 'status'].includes(state.projectSort) ? state.projectSort : 'name';
  const sortGetters = {
    name: (project) => project.name,
    wilaya: (project) => project.wilaya,
    budget: (project) => project.budgetRevised,
    progress: (project) => project.physical,
    status: (project) => project.status
  };
  filtered.sort((a, b) => typeof sortGetters[sortBy](a) === 'number' ? sortGetters[sortBy](b) - sortGetters[sortBy](a) : sortGetters[sortBy](a).localeCompare(sortGetters[sortBy](b), 'fr'));
  const page = state.tablePages.portfolio || 1;
  const pageSize = 6;
  const subset = filtered.slice((page - 1) * pageSize, page * pageSize);
  const financeColumn = roleKeyFor(state.user) !== 'contractor' && visibleKPIs().some((kpi) => kpi.Famille?.startsWith('FI'));
  const title = roleKeyFor(state.user) === 'direction' || roleKeyFor(state.user) === 'pmo' ? 'Portefeuille des projets' : 'Mes projets';
  const rows = subset.map((project) => `<tr><td><button class="btn btn-link p-0 text-start table-project-name" data-project-id="${escapeHTML(project.id)}">${escapeHTML(project.name)}</button><span class="table-project-meta">${escapeHTML(project.id)} · ${escapeHTML(project.owner)}</span></td><td>${escapeHTML(project.sector)}</td><td>${escapeHTML(project.wilaya)}</td><td>${financeColumn ? money(project.budgetRevised) : '—'}</td><td><div class="d-flex align-items-center gap-2"><div class="progress-slim"><span style="width:${project.physical}%"></span></div>${project.physical} %</div></td><td>${shortDate(project.end)}</td><td>${projectStatus(project)}</td><td><button class="btn btn-sm btn-icon btn-text-secondary" aria-label="Ouvrir le projet" data-project-id="${escapeHTML(project.id)}"><i class="bx bx-chevron-right"></i></button></td></tr>`).join('');
  return `${pageHeading(title, role().intro, `<button class="btn btn-outline-secondary btn-sm" data-export="projects"><i class="bx bx-download me-1"></i>Exporter CSV</button>${roleKeyFor(state.user) !== 'direction' ? `<button class="btn btn-primary btn-sm" data-nav="field"><i class="bx bx-plus me-1"></i>Nouvelle saisie</button>` : ''}`)}${demoBanner()}<div class="card"><div class="card-header d-flex flex-wrap align-items-center justify-content-between gap-3"><div><strong>Projets visibles</strong><span class="text-muted small ms-2">${filtered.length} résultat(s) · périmètre : ${escapeHTML(state.user.scope === 'national' ? 'national' : role().name)}</span></div><form class="toolbar" data-form="project-search"><input class="form-control form-control-sm" name="query" value="${escapeHTML(state.globalSearch)}" placeholder="Projet, référence, secteur…" aria-label="Rechercher dans les projets"><select class="form-select form-select-sm" name="status"><option value="">Tous les états</option>${['En cours', 'En retard', 'À l’arrêt', 'À surveiller', 'Données à vérifier'].map((status) => `<option ${state.projectStatus === status ? 'selected' : ''}>${status}</option>`).join('')}</select><select class="form-select form-select-sm" name="sort" aria-label="Trier les projets"><option value="name" ${sortBy === 'name' ? 'selected' : ''}>Trier · nom</option><option value="wilaya" ${sortBy === 'wilaya' ? 'selected' : ''}>Trier · wilaya</option><option value="budget" ${sortBy === 'budget' ? 'selected' : ''}>Trier · AE actuelle</option><option value="progress" ${sortBy === 'progress' ? 'selected' : ''}>Trier · avancement</option><option value="status" ${sortBy === 'status' ? 'selected' : ''}>Trier · état</option></select><button class="btn btn-sm btn-outline-primary">Filtrer</button></form></div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Projet / référence</th><th>Secteur</th><th>Wilaya</th><th>AE actuelle</th><th>Avancement physique</th><th>Fin contractuelle</th><th>État</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="8"><div class="empty-state">Aucun projet ne correspond à la recherche.</div></td></tr>'}</tbody></table></div><div class="table-pagination"><span>${filtered.length ? `Affichage ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filtered.length)} sur ${filtered.length}` : 'Aucun résultat'}</span><div class="d-flex gap-2"><button class="btn btn-outline-secondary" data-page="portfolio" data-delta="-1" ${page <= 1 ? 'disabled' : ''}>Précédent</button><button class="btn btn-outline-secondary" data-page="portfolio" data-delta="1" ${page * pageSize >= filtered.length ? 'disabled' : ''}>Suivant</button></div></div></div>`;
}

function projectPage(project) {
  const tabNames = [
    ['overview', 'Vue d’ensemble'], ['technical', 'Technique'], ['finance', 'Financier'], ['planning', 'Planning & jalons'],
    ['contracts', 'Marchés & avenants'], ['resources', 'Ressources'], ['field', 'Terrain'], ['risks', 'Risques & blocages'],
    ['kpis', 'KPI'], ['alerts', 'Alertes'], ['documents', 'Documents'], ['discussion', 'Discussions'], ['location', 'Localisation'], ['history', 'Historique']
  ].filter(([id]) => id !== 'finance' || canViewFinancialData());
  const tab = state.projectTab;
  const tabBody = projectTabContent(project, tab);
  const editable = rolePermission('kpis', 'AV1') === 'R' || ['mo', 'bet', 'contractor'].includes(roleKeyFor(state.user));
  return `${pageHeading(project.name, `${project.id} · ${project.sector} · ${project.wilaya}`, `<button class="btn btn-outline-secondary btn-sm" data-nav="portfolio"><i class="bx bx-arrow-back me-1"></i>Retour aux projets</button>${editable ? '<button class="btn btn-primary btn-sm" data-nav="field"><i class="bx bx-edit-alt me-1"></i>Ajouter une mise à jour</button>' : ''}`)}${demoBanner()}<div class="card mb-4"><div class="card-body pb-3"><div class="row g-3 align-items-center"><div class="col-lg-5"><div class="d-flex align-items-center gap-3"><span class="shell-brand-icon"><i class="bx bx-buildings"></i></span><div><span class="text-muted small">${escapeHTML(project.id)}</span><h5 class="mb-1">${escapeHTML(project.shortName)}</h5><span class="text-muted small">${escapeHTML(project.owner)} · ${escapeHTML(project.contractor)}</span></div></div></div><div class="col-6 col-lg-2"><span class="text-muted small">Avancement physique</span><strong class="d-block mt-1">${project.physical} %</strong><div class="progress-slim mt-2 w-100"><span style="width:${project.physical}%"></span></div></div>${canViewFinancialData() ? `<div class="col-6 col-lg-2"><span class="text-muted small">AE actuelle</span><strong class="d-block mt-1">${money(project.budgetRevised)}</strong><span class="text-muted small">Initiale ${money(project.budgetInitial)}</span></div>` : ''}<div class="col-6 col-lg-2"><span class="text-muted small">Fin contractuelle</span><strong class="d-block mt-1">${shortDate(project.end)}</strong><span class="text-muted small">Prévision ${shortDate(project.forecast)}</span></div><div class="col-6 col-lg-1">${projectStatus(project)}</div></div></div><div class="project-tabs">${tabNames.map(([id, name]) => `<button class="project-tab ${tab === id ? 'active' : ''}" data-project-tab="${id}">${escapeHTML(name)}</button>`).join('')}</div><div class="card-body">${tabBody}</div></div>`;
}

function projectTabContent(project, tab) {
  const kpis = visibleKPIs();
  const projectAlerts = currentInstances().filter((instance) => instance.projectId === project.id);
  if (tab === 'overview' && !canViewFinancialData()) {
    const facts = [['Wilaya', project.wilaya], ['Secteur', project.sector], ['Dernière mise à jour', shortDate(project.updated)], ['État', project.status]];
    return `<div class="project-overview-grid"><div><div class="row g-3 mb-4">${metricCard('Avancement physique', `${project.physical} %`, 'bx-trending-up', 'Illustratif', 'AV1')}${metricCard('Échéance contractuelle', shortDate(project.end), 'bx-calendar', 'En vigueur', 'DL3')}${metricCard('Alertes visibles', projectAlerts.length, 'bx-bell', 'Périmètre projet')}</div><div class="card"><div class="card-header">Situation du projet</div><div class="card-body">${lineChart('Avancement physique · séries simulées', [24, 31, 36, 44, 51, project.physical])}<div class="row g-3 mt-2">${['Chef de projet', 'Maître d’ouvrage', 'Bureau de contrôle', 'Entreprise'].map((label, index) => `<div class="col-sm-6"><div class="project-fact"><span>${label}</span><strong>${escapeHTML([state.user.scope === 'national' ? 'Équipe projet' : 'Équipe locale', project.owner, project.bet, project.contractor][index])}</strong></div></div>`).join('')}</div></div></div></div><div><div class="card mb-3"><div class="card-header">Informations clés</div><div class="card-body">${facts.map(([label, value]) => `<div class="project-fact"><span>${label}</span><strong>${escapeHTML(value)}</strong></div>`).join('')}</div></div><div class="card"><div class="card-header">Alertes dans le périmètre</div><div class="card-body">${projectAlerts.map((instance) => alertRow(instance)).join('') || '<div class="empty-state py-3">Aucune alerte visible.</div>'}</div></div></div></div>`;
  }
  if (tab === 'finance' && !canViewFinancialData()) return '<div class="access-note">Les données financières ne sont pas incluses dans votre périmètre.</div>';
  if (tab === 'contracts' && !canViewFinancialData()) {
    return `<div class="row g-4"><div class="col-lg-8"><div class="card"><div class="card-header">Marchés & avenants</div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Marché</th><th>Titulaire</th><th>Avenants</th><th>Dernier visa</th></tr></thead><tbody><tr><td class="primary-cell">Marché travaux · lot principal</td><td>${escapeHTML(project.contractor)}</td><td>${project.values.BU2 ?? 4}</td><td><span class="status-pill status-orange">En suivi</span></td></tr><tr><td class="primary-cell">Contrôle technique</td><td>${escapeHTML(project.bet)}</td><td>1</td><td><span class="status-pill status-green">Visé</span></td></tr></tbody></table></div></div></div><div class="col-lg-4"><div class="card"><div class="card-header">Avenants & délais</div><div class="card-body"><div class="row g-3">${['BU1', 'BU2', 'DL2', 'GV2'].filter((id) => rolePermission('kpis', id)).map((id) => kpiMetric(id)).join('')}</div></div></div></div></div>`;
  }
  if (tab === 'overview') return `<div class="project-overview-grid"><div><div class="row g-3 mb-4">${metricCard('Avancement physique', `${project.physical} %`, 'bx-trending-up', 'Illustratif', 'AV1')}${metricCard('Avancement financier', `${project.financial} %`, 'bx-wallet', 'Hors avances', 'FI1')}${metricCard('Échéance contractuelle', shortDate(project.end), 'bx-calendar', 'En vigueur', 'DL3')}${metricCard('Alertes visibles', projectAlerts.length, 'bx-bell', 'Périmètre projet')}</div><div class="card"><div class="card-header">Situation du projet</div><div class="card-body">${lineChart('Avancement physique · séries simulées', [24, 31, 36, 44, 51, project.physical])}<div class="row g-3 mt-2">${['Chef de projet', 'Maître d’ouvrage', 'Bureau de contrôle', 'Entreprise'].map((label, index) => `<div class="col-sm-6"><div class="project-fact"><span>${label}</span><strong>${escapeHTML([state.user.scope === 'national' ? 'Équipe projet' : 'Équipe locale', project.owner, project.bet, project.contractor][index])}</strong></div></div>`).join('')}</div></div></div></div><div><div class="card mb-3"><div class="card-header">Informations clés</div><div class="card-body">${[['Wilaya', project.wilaya], ['Secteur', project.sector], ['Budget initial', money(project.budgetInitial)], ['Budget révisé', money(project.budgetRevised)], ['Dernière mise à jour', shortDate(project.updated)], ['État', project.status]].map(([label, value]) => `<div class="project-fact"><span>${label}</span><strong>${escapeHTML(value)}</strong></div>`).join('')}</div></div><div class="card"><div class="card-header">Alertes dans le périmètre</div><div class="card-body">${projectAlerts.map((instance) => alertRow(instance)).join('') || '<div class="empty-state py-3">Aucune alerte visible.</div>'}</div></div></div></div>`;
  if (tab === 'technical') return `<div class="row g-4"><div class="col-lg-8"><div class="card"><div class="card-header d-flex justify-content-between"><span>Suivi technique & observations</span>${roleKeyFor(state.user) === 'bet' || roleKeyFor(state.user) === 'mo' ? '<button class="btn btn-sm btn-primary" data-nav="field">Ajouter une observation</button>' : ''}</div><div class="card-body"><div class="row g-3">${['AV1', 'QR2', 'QR6', 'QR7'].filter((id) => rolePermission('kpis', id)).map((id) => kpiMetric(id)).join('')}</div>${taskList([project], true)}</div></div></div><div class="col-lg-4"><div class="card"><div class="card-header">Contrôle qualité</div><div class="card-body"><div class="project-fact"><span>Dernière visite</span><strong>10 nov. 2026 · équipe BET</strong></div><div class="project-fact"><span>Observations ouvertes</span><strong>${project.id === 'PRJ-2025-004' ? '3 observations · 1 critique' : '1 observation · 0 critique'}</strong></div><div class="project-fact"><span>Actions correctives</span><strong>Suivi par le responsable de lot</strong></div></div></div></div></div>`;
  if (tab === 'finance') return roleKeyFor(state.user) === 'contractor' ? `<div class="access-note">Les montants des autres contrats ne sont pas accessibles. Cet espace présente uniquement les éléments financiers liés à vos propres marchés.</div><div class="row g-3 mt-2">${['FI1', 'FI6', 'FI7'].filter((id) => rolePermission('kpis', id)).map((id) => kpiMetric(id)).join('')}</div>` : `<div class="row g-4"><div class="col-lg-8"><div class="card"><div class="card-header">Crédits et dépenses · données de démonstration</div><div class="card-body">${horizontalBars([{ label: 'AE initiale', value: project.budgetInitial, display: money(project.budgetInitial) }, { label: 'AE actuelle', value: project.budgetRevised, display: money(project.budgetRevised) }, { label: 'Engagements', value: project.budgetRevised * 0.72, display: money(project.budgetRevised * 0.72) }, { label: 'Paiements réalisés', value: project.budgetRevised * project.financial / 100, display: money(project.budgetRevised * project.financial / 100) }])}${lineChart('Progression physique et financière · série illustrative', [25, 32, 38, 42, 51, project.financial])}</div></div></div><div class="col-lg-4"><div class="card"><div class="card-header">Indicateurs financiers visibles</div><div class="card-body"><div class="row g-3">${['FI1', 'FI2', 'FI3', 'FI4', 'FI5', 'FI6', 'FI7', 'BU1'].filter((id) => rolePermission('kpis', id)).map((id) => kpiMetric(id)).join('')}</div></div></div></div></div>`;
  if (tab === 'planning') return planningRows([project]);
  if (tab === 'contracts') return `<div class="row g-4"><div class="col-lg-8"><div class="card"><div class="card-header">Marchés & avenants</div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Marché</th><th>Titulaire</th><th>Montant initial</th><th>Avenants</th><th>Dernier visa</th></tr></thead><tbody><tr><td class="primary-cell">Marché travaux · lot principal</td><td>${escapeHTML(project.contractor)}</td><td>${money(project.budgetInitial)}</td><td>${project.values.BU2 ?? 4}</td><td><span class="status-pill status-orange">En suivi</span></td></tr><tr><td class="primary-cell">Contrôle technique</td><td>${escapeHTML(project.bet)}</td><td>${money(project.budgetInitial * 0.035)}</td><td>1</td><td><span class="status-pill status-green">Visé</span></td></tr></tbody></table></div></div></div><div class="col-lg-4"><div class="card"><div class="card-header">Avenants & délais</div><div class="card-body"><div class="row g-3">${['BU1', 'BU2', 'DL2', 'GV2'].filter((id) => rolePermission('kpis', id)).map((id) => kpiMetric(id)).join('')}</div></div></div></div></div>`;
  if (tab === 'resources') return `<div class="row g-4"><div class="col-md-6"><div class="card"><div class="card-header">Moyens mobilisés</div><div class="card-body">${horizontalBars([{ label: 'Équipe terrain', value: 73, display: '73 %' }, { label: 'Équipements', value: 61, display: '61 %' }, { label: 'Matériaux disponibles', value: 88, display: '88 %' }])}<div class="access-note mt-3">Indicateurs illustratifs · aucune donnée de concurrent n’est affichée.</div></div></div></div><div class="col-md-6"><div class="card"><div class="card-header">Point hebdomadaire</div><div class="card-body"><div class="project-fact"><span>Semaine</span><strong>46 · 9–15 novembre 2026</strong></div><div class="project-fact"><span>Planifié</span><strong>12 tâches · 4 jalons</strong></div><div class="project-fact"><span>Exécuté</span><strong>${project.physical} % · point de situation fictif</strong></div></div></div></div></div>`;
  if (tab === 'field') return fieldForm([project], true);
  if (tab === 'risks') return `<div class="row g-4"><div class="col-lg-8"><div class="card"><div class="card-header">Blocages & risques institutionnels</div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Nature</th><th>Âge</th><th>Responsable</th><th>Échéance cible</th><th>Situation</th></tr></thead><tbody><tr><td class="primary-cell">Libération d’emprise · accès chantier</td><td>${project.values.QR3 ?? 42} j</td><td>${project.owner}</td><td>20 nov. 2026</td><td><span class="status-pill status-orange">En cours</span></td></tr><tr><td class="primary-cell">Interférence réseau · déplacement</td><td>28 j</td><td>Gestionnaire de réseau</td><td>30 nov. 2026</td><td><span class="status-pill status-info">À confirmer</span></td></tr></tbody></table></div></div></div><div class="col-lg-4"><div class="card"><div class="card-header">Indicateurs de blocage</div><div class="card-body"><div class="row g-3">${['QR1', 'QR2', 'QR3', 'QR4', 'GV1'].filter((id) => rolePermission('kpis', id)).map((id) => kpiMetric(id)).join('')}</div></div></div></div></div>`;
  if (tab === 'kpis') return `<div class="row g-3">${kpis.map((item) => projectKpiRow(item, project)).join('') || '<div class="empty-state">Aucun KPI visible pour ce rôle.</div>'}</div>`;
  if (tab === 'alerts') return `<div class="row g-3">${projectAlerts.map((instance) => alertRow(instance)).join('') || '<div class="empty-state">Aucune alerte visible sur ce projet.</div>'}</div>`;
  if (tab === 'documents') return `<div class="row g-3">${visibleDocuments().filter((document) => document.projectId === project.id).map(documentCard).join('') || '<div class="empty-state">Aucun document visible pour ce projet.</div>'}<button class="btn btn-outline-primary btn-sm" data-nav="documents">Ouvrir le dossier documentaire</button></div>`;
  if (tab === 'discussion') return `<div class="alert alert-secondary">La discussion de projet est conservée dans l’espace de communication et associée à ce projet.</div><button class="btn btn-primary btn-sm" data-nav="messages">Ouvrir la discussion projet</button>`;
  if (tab === 'location') return `<div class="row g-4"><div class="col-lg-8"><div class="algeria-map">${nationalMap([project], false, project.id)}</div></div><div class="col-lg-4"><div class="card"><div class="card-header">Localisation du projet</div><div class="card-body">${[['Wilaya', project.wilaya], ['Secteur', project.sector], ['Coordonnées', 'Localisation indicative · démonstration'], ['Mise à jour', shortDate(project.updated)]].map(([label, value]) => `<div class="project-fact"><span>${label}</span><strong>${escapeHTML(value)}</strong></div>`).join('')}</div></div></div></div>`;
  return `<div class="card"><div class="card-header">Historique d’activité · données illustratives</div><div class="card-body">${[['11 nov. 2026', 'Actualisation du suivi mensuel', 'CNED / PMO'], ['08 nov. 2026', 'Rapport de visite déposé', project.owner], ['04 nov. 2026', 'Observation technique consignée', project.bet], ['30 oct. 2026', 'Réunion de coordination', 'Équipe projet']].map(([date, text, actor]) => `<div class="alert-row"><span class="alert-severity orange"></span><span class="alert-row-content"><strong>${escapeHTML(text)}</strong><span>${escapeHTML(date)} · ${escapeHTML(actor)}</span></span></div>`).join('')}</div></div>`;
}

function projectKpiRow(item, project) {
  const value = valueFor(item, project);
  const status = statusFor(item, value, project);
  const permission = rolePermission('kpis', item.KPI_ID);
  return `<div class="col-md-6 col-xl-4"><button class="card kpi-summary-card text-start w-100 h-100" data-kpi-id="${escapeHTML(item.KPI_ID)}"><div class="card-body"><div class="d-flex justify-content-between align-items-center"><span class="kpi-id">${escapeHTML(item.KPI_ID)}</span>${statusPill(status)}</div><strong class="d-block mt-3">${escapeHTML(formatValue(item, value))}</strong><span class="d-block small text-muted">${escapeHTML(item.Nom_KPI)}</span><span class="d-block mt-2 small text-muted">Droit : ${escapeHTML(permission)} · ${escapeHTML(item.Fréquence_cible || '')}</span></div></button></div>`;
}

function financePage() {
  const scoped = allScopedProjects();
  const initial = sum(scoped, (project) => project.budgetInitial);
  const revised = sum(scoped, (project) => project.budgetRevised);
  const committed = revised * 0.72;
  const paid = revised * 0.46;
  const pending = Math.max(0, committed - paid);
  const financeKpis = ['FI1', 'FI2', 'FI3', 'FI4', 'FI5', 'FI6', 'FI7', 'BU1', 'BU3'].filter((id) => rolePermission('kpis', id));
  const projectsRows = scoped.map((project) => `<tr><td><button class="btn btn-link p-0 text-start table-project-name" data-project-id="${escapeHTML(project.id)}">${escapeHTML(project.shortName)}</button><span class="table-project-meta">${escapeHTML(project.id)} · ${escapeHTML(project.wilaya)}</span></td><td>${money(project.budgetInitial)}</td><td>${money(project.budgetRevised)}</td><td>${money(project.budgetRevised * 0.72)}</td><td>${money(project.budgetRevised * project.financial / 100)}</td><td>${money(project.budgetRevised * 0.72 - project.budgetRevised * project.financial / 100)}</td><td>${project.financial} %</td><td>${projectStatus(project)}</td></tr>`).join('');
  return `${pageHeading('Suivi financier', `AE, crédits de paiement et situations · ${scoped.length} projet(s) dans le périmètre attribué`, `<button class="btn btn-outline-secondary btn-sm" data-export="projects"><i class="bx bx-download me-1"></i>Exporter</button>`)}${demoBanner()}<div class="row g-4 mb-4">${metricCard('AE initiale', money(initial), 'bx-wallet', 'Périmètre visible')}${metricCard('AE actuelle', money(revised), 'bx-transfer-alt', 'Après révisions', 'FI4')}${metricCard('Engagements', money(committed), 'bx-check-circle', '72 % · illustration')}${metricCard('Paiements exécutés', money(paid), 'bx-credit-card', '46 % · illustration', 'FI6')}</div><div class="row g-4 mb-4"><div class="col-xl-8"><div class="card h-100"><div class="card-header d-flex justify-content-between align-items-center"><span>AE, engagements & paiements</span><span class="small text-muted">Données de démonstration · Md DA</span></div><div class="card-body">${horizontalBars([{ label: 'AE initiale', value: initial, display: money(initial) }, { label: 'AE actuelle', value: revised, display: money(revised) }, { label: 'Engagements', value: committed, display: money(committed) }, { label: 'Paiements effectués', value: paid, display: money(paid) }, { label: 'Encours estimé', value: pending, display: money(pending) }])}${lineChart('Évolution des paiements · séries illustratives', [20, 27, 35, 38, 48, 57])}</div></div></div><div class="col-xl-4"><div class="card h-100"><div class="card-header">Indicateurs financiers autorisés</div><div class="card-body"><div class="row g-3">${financeKpis.map((id) => kpiMetric(id)).join('') || '<div class="empty-state">Aucun KPI financier visible.</div>'}</div></div></div></div></div><div class="card mb-4"><div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2"><span>Situation financière par projet</span><span class="small text-muted">Paiements et soldes illustratifs · aucune connexion Trésor / Finances</span></div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Projet / wilaya</th><th>AE initiale</th><th>AE actuelle</th><th>Engagements</th><th>Dépenses payées</th><th>Reste engagé</th><th>Progression financière</th><th>État</th></tr></thead><tbody>${projectsRows || '<tr><td colspan="8"><div class="empty-state">Aucun projet financier attribué.</div></td></tr>'}</tbody></table></div></div><div class="row g-4"><div class="col-lg-7"><div class="card"><div class="card-header">Situations & réévaluations en attente</div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Référence</th><th>Projet</th><th>Montant</th><th>Ancienneté</th><th>Statut</th></tr></thead><tbody>${scoped.slice(0, 4).map((project, index) => `<tr><td class="primary-cell">ST-${2026}-${String(18 + index).padStart(3, '0')}</td><td>${escapeHTML(project.shortName)}</td><td>${money(project.budgetRevised * 0.035)}</td><td>${[76, 34, 128, 52][index]} j</td><td><span class="status-pill ${index === 2 ? 'status-red' : 'status-orange'}">${index === 2 ? 'À régulariser' : 'En instruction'}</span></td></tr>`).join('') || '<tr><td colspan="5" class="text-muted">Aucune situation dans le périmètre.</td></tr>'}</tbody></table></div></div></div><div class="col-lg-5"><div class="card"><div class="card-header">Cohérence physique – financière</div><div class="card-body">${scoped.slice(0, 4).map((project) => `<div class="financial-bar"><span class="financial-bar-label">${escapeHTML(project.shortName)}</span><div class="d-flex gap-1"><div class="financial-bar-track flex-fill"><span style="width:${project.physical}%"></span></div><div class="financial-bar-track flex-fill"><span style="width:${project.financial}%;background:#79a98f"></span></div></div><span class="financial-bar-value">${project.physical} / ${project.financial} %</span></div>`).join('')}<div class="d-flex gap-3 small text-muted mt-2"><span><i class="bx bx-square text-primary me-1"></i>Physique</span><span><i class="bx bx-square text-success me-1"></i>Financier</span></div></div></div></div></div>`;
}

function planningRows(items) {
  const monthNames = ['Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.', 'Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai'];
  const rows = items.flatMap((project) => [
    { title: `${project.shortName} · études et visas`, start: 5, width: 23, cls: 'complete' },
    { title: `${project.shortName} · travaux principaux`, start: 2, width: 59, cls: project.status === 'En retard' || project.status === 'À l’arrêt' ? 'critical' : 'delayed' },
    { title: `${project.shortName} · essais & réception`, start: 8, width: 25, cls: 'complete' }
  ]);
  return `<div class="gantt-wrap"><div class="gantt"><div class="gantt-months"><strong>Projet / activité</strong>${monthNames.map((month) => `<span>${month}</span>`).join('')}</div>${rows.map((row) => `<div class="gantt-row"><span class="gantt-title">${escapeHTML(row.title)}</span><div class="gantt-track"><span class="gantt-bar ${row.cls}" style="left:${row.start / 12 * 100}%;width:${row.width / 12 * 100}%" title="${escapeHTML(row.title)}"></span></div></div>`).join('')}</div></div>`;
}

function planningPage() {
  const scoped = allScopedProjects();
  const delayed = scoped.filter((project) => new Date(project.forecast) > new Date(project.end));
  return `${pageHeading('Planning & jalons', `Dates contractuelles, prévisions et planification · ${scoped.length} projets visibles`, `<select class="form-select form-select-sm" data-planning-range aria-label="Période"><option>12 prochains mois</option><option>6 prochains mois</option><option>24 prochains mois</option></select>`)}${demoBanner()}<div class="row g-4 mb-4">${metricCard('Jalons suivis', scoped.length * 3, 'bx-flag', '12 prochains mois')}${metricCard('Projets en dérive', delayed.length, 'bx-time-five', 'Prévision après échéance')}${metricCard('Échéances contractuelles', scoped.filter((project) => project.end >= '2026-11-13').length, 'bx-calendar-check', 'En vigueur')}${metricCard('Actions hebdomadaires', scoped.length * 4, 'bx-list-check', 'Saisies illustratives')}</div><div class="card mb-4"><div class="card-header d-flex flex-wrap justify-content-between gap-2"><span>Calendrier prévisionnel · juin 2026 à mai 2027</span><span class="small text-muted">Les durées et dépendances sont illustratives</span></div><div class="card-body">${planningRows(scoped)}</div></div><div class="card"><div class="card-header">Jalons contractuels & points de contrôle</div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Projet</th><th>Jalon</th><th>Échéance contractuelle</th><th>Date prévisionnelle</th><th>Écart</th><th>Responsable</th><th>État</th></tr></thead><tbody>${scoped.map((project, index) => `<tr><td><button class="btn btn-link p-0 text-start table-project-name" data-project-id="${escapeHTML(project.id)}">${escapeHTML(project.shortName)}</button></td><td>${['Achèvement gros œuvre', 'Libération emprise', 'Essais et mise en service'][index % 3]}</td><td>${shortDate(project.end)}</td><td>${shortDate(project.forecast)}</td><td>${new Date(project.forecast) > new Date(project.end) ? '<span class="status-pill status-orange">+ ' + (index + 2) + ' mois</span>' : '<span class="text-success">Dans le délai</span>'}</td><td>${escapeHTML(project.owner)}</td><td>${projectStatus(project)}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function technicalPage() {
  const scoped = allScopedProjects();
  const betView = roleKeyFor(state.user) === 'bet';
  return `${pageHeading('Suivi technique', `${betView ? 'Projets et marchés surveillés par votre BET' : 'Avancement, qualité et mesures correctives dans votre périmètre'}`, `<button class="btn btn-primary btn-sm" data-nav="field"><i class="bx bx-plus me-1"></i>Nouvelle observation</button>`)}${demoBanner()}<div class="row g-4 mb-4">${metricCard('Projets suivis', scoped.length, 'bx-buildings', betView ? 'Affectations BET' : 'Projets accessibles')}${metricCard('Observations ouvertes', scoped.length + 2, 'bx-search-alt', 'Contrôle qualité')}${metricCard('Non-conformités critiques', scoped.some((project) => (project.values.QR7 || 0) > 30) ? 1 : 0, 'bx-error', 'Action à vérifier', 'QR7')}${metricCard('Réceptions à préparer', Math.max(1, scoped.length), 'bx-check-square', 'Réserves & essais', 'GV4')}</div><div class="row g-4"><div class="col-xl-8"><div class="card"><div class="card-header d-flex justify-content-between"><span>Projets & observations techniques</span><button class="btn btn-sm btn-outline-secondary" data-nav="portfolio">Voir les projets</button></div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Projet / wilaya</th><th>Avancement</th><th>Observations ouvertes</th><th>NC la plus ancienne</th><th>Prochaine revue</th></tr></thead><tbody>${scoped.map((project, index) => `<tr><td><button class="btn btn-link p-0 text-start table-project-name" data-project-id="${escapeHTML(project.id)}">${escapeHTML(project.shortName)}</button><span class="table-project-meta">${escapeHTML(project.wilaya)} · ${escapeHTML(project.bet)}</span></td><td>${project.physical} %</td><td>${index + 1}</td><td>${project.values.QR7 || 0} j</td><td>${shortDate('2026-11-20')}</td></tr>`).join('')}</tbody></table></div></div></div><div class="col-xl-4"><div class="card mb-4"><div class="card-header">Indicateurs techniques autorisés</div><div class="card-body"><div class="row g-3">${['AV1', 'QR2', 'QR5', 'QR6', 'QR7', 'QR8', 'GV4'].filter((id) => rolePermission('kpis', id)).map((id) => kpiMetric(id)).join('') || '<div class="empty-state">Aucun KPI technique visible.</div>'}</div></div></div><div class="card"><div class="card-header">Alertes techniques visibles</div><div class="card-body">${latestAlertRows(4)}</div></div></div></div>`;
}

function fieldForm(scoped = allScopedProjects(), compact = false) {
  const selected = state.projectId && scoped.some((project) => project.id === state.projectId) ? state.projectId : scoped[0]?.id;
  const disabled = !scoped.length;
  return `<form class="field-mobile-frame" data-form="field-report"><div class="field-mobile-header"><div><strong class="small">Nouveau rapport terrain</strong><span class="d-block small text-muted">Saisie locale · données de démonstration</span></div><span class="offline-pill"><i class="bx bx-wifi-off"></i>Hors ligne · 2 en attente</span></div><div class="p-3"><div class="mb-3"><label class="form-label">Projet concerné</label><select class="form-select" name="projectId" required ${disabled ? 'disabled' : ''}>${scoped.map((project) => `<option value="${escapeHTML(project.id)}" ${project.id === selected ? 'selected' : ''}>${escapeHTML(project.shortName)} · ${escapeHTML(project.wilaya)}</option>`).join('')}</select></div><div class="row g-3"><div class="col-sm-6"><label class="form-label">Type de rapport</label><select class="form-select" name="type"><option>Visite de chantier</option><option>Avancement hebdomadaire</option><option>Observation technique</option><option>Blocage / emprise</option><option>Mobilisation des moyens</option></select></div><div class="col-sm-6"><label class="form-label">Avancement physique (%)</label><input class="form-control" type="number" min="0" max="100" name="progress" placeholder="ex. 62"></div></div><div class="mt-3"><label class="form-label">Observation / action à suivre</label><textarea class="form-control" name="note" rows="3" required placeholder="Décrire la situation observée et l’action proposée…"></textarea></div><div class="mt-3"><label class="form-label">Photographie ou justificatif</label><div class="d-flex align-items-center gap-3"><input class="form-control" type="file" name="photo" accept="image/*,.pdf" capture="environment"><span class="photo-preview" data-photo-preview><i class="bx bx-camera"></i></span></div><small class="form-text">Aperçu local uniquement · aucun fichier n’est transmis à un serveur.</small></div><div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mt-4"><span class="small text-muted"><i class="bx bx-map-pin me-1"></i>Position GPS non collectée</span><button class="btn btn-primary" type="submit" ${disabled ? 'disabled' : ''}><i class="bx bx-save me-1"></i>Enregistrer le rapport</button></div></div></form>`;
}

function fieldPage() {
  const scoped = allScopedProjects();
  const reports = state.fieldReports.filter((report) => scopedProjectIds().has(report.projectId));
  return `${pageHeading('Terrain & rapports', 'Interface mobile-first · visites, avancement, moyens et observations de chantier', `<span class="offline-pill"><i class="bx bx-wifi-off"></i>Mode hors ligne simulé</span>`)}${demoBanner()}<div class="row g-4"><div class="col-xl-7"><div class="field-mobile-frame"><div class="field-mobile-header"><div><strong>Activité de terrain</strong><span class="d-block small text-muted">${escapeHTML(state.user.organization)}</span></div><span class="offline-pill"><i class="bx bx-cloud-upload"></i>${reports.length + 2} en attente de synchro</span></div><div class="p-3"><div class="row g-3 mb-4">${metricCard('Projets affectés', scoped.length, 'bx-map-pin', 'Votre périmètre')}${metricCard('Rapports récents', reports.length + 4, 'bx-file', 'Dernière semaine')}${metricCard('Avancement hebdomadaire', '72 %', 'bx-trending-up', 'PP1', 'PP1')}${metricCard('Moyens mobilisés', '68 %', 'bx-wrench', 'PP2', 'PP2')}</div>${fieldForm(scoped)}</div></div></div><div class="col-xl-5"><div class="card mb-4"><div class="card-header d-flex justify-content-between"><span>Rapports récents</span><span class="status-pill status-orange">${reports.length} en attente</span></div><div class="card-body">${reports.map((report) => `<div class="alert-row"><span class="alert-severity orange"></span><span class="alert-row-content"><strong>${escapeHTML(report.type)} · ${escapeHTML(projectById(report.projectId)?.shortName || '')}</strong><span>${escapeHTML(report.author)} · ${escapeHTML(report.date)} · ${escapeHTML(report.status)}</span><span>${escapeHTML(report.note)}${report.fileName ? ` · ${escapeHTML(report.fileName)}` : ''}</span></span></div>`).join('') || '<div class="empty-state py-3">Les rapports enregistrés apparaîtront ici.</div>'}</div></div><div class="card"><div class="card-header">Points de situation par projet</div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>Projet</th><th>Emprise</th><th>Réseaux</th><th>Statut chantier</th></tr></thead><tbody>${scoped.map((project) => `<tr><td><button class="btn btn-link p-0 text-start" data-project-id="${escapeHTML(project.id)}">${escapeHTML(project.shortName)}</button></td><td>${project.values.QR1 ?? '—'} %</td><td>${project.values.QR2 ?? '—'} %</td><td>${project.status === 'À l’arrêt' ? '<span class="status-pill status-red">Arrêt en cours</span>' : '<span class="status-pill status-green">En activité</span>'}</td></tr>`).join('')}</tbody></table></div></div></div></div>`;
}

function nationalMap(items, mini = false, focusId = null) {
  const project = referenceProjects.find((entry) => entry.slug === focusId);
  const visible = ['direction', 'pmo'].includes(roleKeyFor(state.user)) ? referenceProjects : [];
  const filtered = visible.filter((entry) => !project || entry.slug === project.slug);
  return `<div class="${mini ? 'leaflet-mini-map' : 'algeria-map'}" data-leaflet-map="embedded-${mini ? 'mini' : 'detail'}" data-map-mode="${project ? 'project' : 'reference'}" ${project ? `data-project-slug="${project.slug}"` : ''} data-project-list="${filtered.map((entry) => entry.slug).join(',')}"></div>`;
}

function mapPage() {
  const filters = state.mapFilters || {};
  const nationallyScoped = ['direction', 'pmo'].includes(roleKeyFor(state.user));
  const mapProjects = nationallyScoped ? referenceProjects : [];
  const visibleProjects = mapProjects.filter((project) => {
    const wilayaMatch = !filters.wilaya || project.wilayas.includes(filters.wilaya);
    const regionMatch = !filters.region || project.wilayas.some((name) => wilayas.some((item) => item.name === name && item.region === filters.region));
    const sectorMatch = !filters.sector || project.sector === filters.sector;
    const statusMatch = !filters.status || referenceStatus(project) === filters.status;
    const queryMatch = !filters.query || `${project.name} ${project.id} ${project.sector} ${project.wilayas.join(' ')}`.toLowerCase().includes(filters.query.toLowerCase());
    const budget = project.aeCurrent;
    const budgetMatch = !filters.budget || (filters.budget === 'under-25' ? budget < 25 : filters.budget === '25-100' ? budget >= 25 && budget < 100 : budget >= 100);
    const alertCount = referenceAlerts(project).filter((alert) => alert.severity === 'Critique').length;
    const alertMatch = !filters.alertSeverity || (filters.alertSeverity === 'critical' ? alertCount > 0 : alertCount === 0);
    return wilayaMatch && regionMatch && sectorMatch && statusMatch && queryMatch && budgetMatch && alertMatch;
  });
  const selected = visibleProjects.find((project) => project.slug === state.selectedMapProject) || visibleProjects[0] || null;
  state.selectedMapProject = selected?.slug || null;
  const selectedWilayas = filters.region ? wilayas.filter((item) => item.region === filters.region) : wilayas;
  const projectList = visibleProjects.map((project) => `<button class="reference-map-project list-group-item list-group-item-action d-flex justify-content-between align-items-start gap-2 ${selected?.slug === project.slug ? 'active' : ''}" data-reference-map-project="${project.slug}">
    <span><strong class="d-block">${escapeHTML(project.name)}</strong><small>${escapeHTML(project.id)} · ${escapeHTML(project.wilayas.join(', '))} · ${escapeHTML(project.sector)}</small></span>${referenceStatusBadge(project)}
  </button>`).join('');
  const wilayaOptions = wilayas.map((item) => `<option value="${escapeHTML(item.name)}" ${filters.wilaya === item.name ? 'selected' : ''}>${item.code} · ${escapeHTML(state.lang === 'ar' ? item.nameAr : item.name)}</option>`).join('');
  const sectorOptions = [...new Set(referenceProjects.map((item) => item.sector))].map((item) => `<option ${filters.sector === item ? 'selected' : ''}>${escapeHTML(item)}</option>`).join('');
  const statusOptions = ['À l’arrêt', 'En retard', 'À surveiller'].map((item) => `<option ${filters.status === item ? 'selected' : ''}>${item}</option>`).join('');
  const regions = [...new Set(wilayas.map((item) => item.region))];
  const content = state.mapView === 'map'
    ? `<div class="leaflet-map" id="national-leaflet-map" data-leaflet-map="national" data-map-mode="reference" data-project-list="${visibleProjects.map((project) => project.slug).join(',')}" data-wilaya-list="${selectedWilayas.map((item) => item.code).join(',')}" data-selected-project="${selected?.slug || ''}"></div>`
    : `<div class="list-group reference-map-list">${projectList || '<div class="empty-state">Aucun projet de référence ne correspond aux filtres.</div>'}</div>`;
  return `${pageHeading('Carte nationale des projets', 'Carte Leaflet · projets suivis CNED et couverture géographique des 69 wilayas', `<button class="btn btn-outline-secondary btn-sm" data-map-toggle><i class="bx bx-list-ul me-1"></i>${state.mapView === 'map' ? 'Vue liste' : 'Vue carte'}</button><button class="btn btn-outline-primary btn-sm" data-map-fit><i class="bx bx-fullscreen me-1"></i>Voir tout</button>`)}
    <div class="card"><div class="card-header"><strong>Filtres géographiques et de portefeuille</strong></div><div class="card-body">
      <form class="reference-map-filters" data-form="map-filters">
        <label>Rechercher<input class="form-control form-control-sm" name="query" value="${escapeHTML(filters.query || '')}" placeholder="Projet, référence, secteur"></label>
        <label>Wilaya<select class="form-select form-select-sm" name="wilaya"><option value="">Toutes les wilayas</option>${wilayaOptions}</select></label>
        <label>Région<select class="form-select form-select-sm" name="region"><option value="">Toutes les régions</option>${regions.map((item) => `<option ${filters.region === item ? 'selected' : ''}>${escapeHTML(item)}</option>`).join('')}</select></label>
        <label>Secteur<select class="form-select form-select-sm" name="sector"><option value="">Tous les secteurs</option>${sectorOptions}</select></label>
        <label>État<select class="form-select form-select-sm" name="status"><option value="">Tous les états</option>${statusOptions}</select></label>
        <label>AE actuelle<select class="form-select form-select-sm" name="budget"><option value="">Tous montants</option><option value="under-25" ${filters.budget === 'under-25' ? 'selected' : ''}>Moins de 25 Md DA</option><option value="25-100" ${filters.budget === '25-100' ? 'selected' : ''}>25 à 100 Md DA</option><option value="over-100" ${filters.budget === 'over-100' ? 'selected' : ''}>100 Md DA et plus</option></select></label>
        <label>Alerte critique<select class="form-select form-select-sm" name="alertSeverity"><option value="">Toutes</option><option value="critical" ${filters.alertSeverity === 'critical' ? 'selected' : ''}>Avec alerte critique</option><option value="none" ${filters.alertSeverity === 'none' ? 'selected' : ''}>Sans alerte critique</option></select></label>
        <div class="d-flex gap-2 align-items-end"><button class="btn btn-primary btn-sm">Appliquer</button><button type="button" class="btn btn-outline-secondary btn-sm" data-map-reset>Réinitialiser</button></div>
      </form>
      <div class="map-layout reference-map-layout mt-4"><div>${content}<p class="small text-muted mt-2 mb-0" data-map-message>Les points de wilaya sont des repères indicatifs dérivés des coordonnées des communes source, pas des limites administratives. Les tracés des infrastructures ne sont pas fournis.</p></div>
        <aside class="reference-map-aside"><div class="map-legend mb-3"><span><i class="legend-dot" style="background:#bf5550"></i>À l’arrêt</span><span><i class="legend-dot" style="background:#c97b21"></i>En retard / surveillance</span><span><i class="legend-dot" style="background:#428b6e"></i>Suivi normal</span></div>
          <strong>${visibleProjects.length} projet(s) suivi(s) · ${selectedWilayas.length} wilaya(s) affichée(s)</strong>
          <div class="list-group reference-map-project-list mt-2">${projectList || '<div class="empty-state py-3">Aucun projet ne correspond aux filtres.</div>'}</div>
          ${selected ? `<div class="map-selection mt-3" data-map-selection><span class="eyebrow">Projet sélectionné</span><h6 class="mt-2 mb-1">${escapeHTML(selected.name)}</h6><p class="small text-muted">${escapeHTML(selected.id)} · ${escapeHTML(selected.wilayas.join(', '))} · ${escapeHTML(selected.sector)}</p>${referenceStatusBadge(selected)}
            <div class="project-fact mt-3"><span>AE actuelle</span><strong>${referenceNumber(selected.aeCurrent)} Md DA</strong></div>
            <div class="project-fact"><span>Avancement physique / financier</span><strong>${referenceNumber(selected.physical, 1)} % / ${referenceNumber(selected.financial, 1)} %</strong></div>
            <div class="project-fact"><span>Fin contractuelle</span><strong>${escapeHTML(selected.contractualEnd)}</strong></div>
            <div class="project-fact"><span>Alertes actives</span><strong>${referenceAlerts(selected).length}</strong></div>
            <button class="btn btn-primary w-100 mt-3" data-reference-project="${selected.slug}">Ouvrir la fiche projet</button>
          </div>` : '<div class="empty-state py-3">Les projets démonstratifs des rôles non nationaux ne disposent pas de coordonnées fiables. Les wilayas restent consultables.</div>'}
          <div class="small text-muted mt-3">Référentiel géographique : <a href="${wilayaSource.url}" target="_blank" rel="noopener noreferrer">Algeria-Cities</a> · licence ${wilayaSource.license}.</div>
        </aside>
      </div>
    </div></div>`;
}

function documentCard(document) {
  const project = projectById(document.projectId);
  return `<div class="col-md-6 col-xl-4"><div class="card h-100"><div class="card-body"><div class="d-flex align-items-start gap-3"><span class="document-type">${escapeHTML(document.type)}</span><div class="min-w-0 flex-grow-1"><button class="btn btn-link p-0 text-start fw-semibold small text-truncate d-block w-100" data-doc-preview="${escapeHTML(document.name)}">${escapeHTML(document.name)}</button><span class="d-block small text-muted mt-1">${escapeHTML(project?.shortName || '')}</span></div></div><div class="d-flex justify-content-between align-items-center mt-3"><span class="badge bg-label-secondary">${escapeHTML(document.category)}</span><span class="small text-muted">${escapeHTML(document.version)}</span></div><div class="d-flex justify-content-between align-items-center mt-3 small text-muted"><span>${escapeHTML(document.owner)}</span><span>${shortDate(document.date)}</span></div><div class="d-flex justify-content-between align-items-center border-top pt-2 mt-2"><span class="small ${document.access.includes('Restreint') ? 'doc-private' : 'text-muted'}"><i class="bx ${document.access.includes('Restreint') ? 'bx-lock-alt' : 'bx-group'} me-1"></i>${escapeHTML(document.access)}</span><button class="btn btn-sm btn-icon btn-text-secondary" data-doc-preview="${escapeHTML(document.name)}" aria-label="Prévisualiser"><i class="bx bx-show"></i></button></div></div></div></div>`;
}

function documentsPage() {
  const all = visibleDocuments();
  const category = state.documentFilters.category || '';
  const query = (state.documentFilters.query || '').trim().toLowerCase();
  const filtered = all.filter((item) => (!category || item.category === category) && (!query || `${item.name} ${item.category} ${projectById(item.projectId)?.shortName}`.toLowerCase().includes(query)));
  const categories = [...new Set(all.map((item) => item.category))];
  return `${pageHeading('Documents', 'Dossiers projets, rapports, études et documents de démonstration', `<button class="btn btn-primary btn-sm" data-action="show-upload"><i class="bx bx-upload me-1"></i>Ajouter un document</button>`)}${demoBanner()}<div class="card mb-4"><div class="card-body"><form class="toolbar" data-form="document-filter"><input class="form-control form-control-sm" name="document-query" value="${escapeHTML(query)}" placeholder="Rechercher un fichier, projet…" aria-label="Rechercher un document"><select class="form-select form-select-sm" name="document-category"><option value="">Toutes catégories</option>${categories.map((item) => `<option ${category === item ? 'selected' : ''}>${escapeHTML(item)}</option>`).join('')}</select><button class="btn btn-sm btn-outline-primary">Filtrer</button><span class="ms-auto small text-muted">${filtered.length} document(s) · accès par périmètre de projet</span></form></div></div><div class="row g-4">${filtered.map(documentCard).join('') || '<div class="col-12"><div class="empty-state"><i class="bx bx-folder-open"></i>Aucun document visible pour ces critères.</div></div>'}</div><div class="mt-4"><div class="access-note">Les documents sont simulés localement. Un ajout conserve les métadonnées du fichier dans le navigateur, sans transfert ni stockage serveur.</div></div>`;
}

const referenceMessageRecipients = [
  'Maître d’ouvrage',
  'Bureau d’études',
  'Organisme de contrôle',
  'Bureau de contrôle et suivi',
  'Contractant',
  'Autorités locales',
  'Gestionnaires de réseaux',
  'Ministère de tutelle'
];

function referenceActionRecipient(action) {
  const recipients = action.recipients.toLocaleLowerCase('fr');
  if (recipients.includes('contractant')) return 'Contractant';
  if (recipients.includes('autorités locales')) return 'Autorités locales';
  if (recipients.includes('gestionnaires de réseaux')) return 'Gestionnaires de réseaux';
  if (recipients.includes('bet')) return 'Bureau d’études';
  return 'Maître d’ouvrage';
}

function referenceFollowupPage() {
  const actions = referenceActions.map((action, index) => {
    const project = referenceProjectBySlug(action.projectSlug);
    return `<tr>
      <td><strong>${escapeHTML(project?.name || 'Projet indisponible')}</strong></td>
      <td>${escapeHTML(action.action)}</td>
      <td>${escapeHTML(action.recipients)}</td>
      <td><span class="badge bg-label-secondary">À fixer</span></td>
      <td><button class="btn btn-sm btn-outline-primary" type="button" data-prepare-reference-action="${index}">Préparer</button></td>
    </tr>`;
  }).join('');
  const projects = referenceProjects.map((project) => `<option value="${escapeHTML(project.slug)}">${escapeHTML(project.name)}</option>`).join('');
  const recipients = referenceMessageRecipients.map((recipient) => `<option value="${escapeHTML(recipient)}">${escapeHTML(recipient)}</option>`).join('');
  const journal = state.referenceMessageJournal.map((entry) => {
    const project = referenceProjectBySlug(entry.projectSlug);
    return `<tr>
      <td>${escapeHTML(entry.date || '')}</td>
      <td>${escapeHTML(project?.name || 'Projet indisponible')}</td>
      <td>${escapeHTML(entry.recipient || '')}</td>
      <td>${escapeHTML(entry.type || '')}</td>
      <td title="${escapeHTML(entry.subject || '')}">${escapeHTML(entry.subject || '')}</td>
      <td><span class="badge bg-label-info">${escapeHTML(entry.status || 'Enregistré')}</span></td>
    </tr>`;
  }).join('');
  return `${pageHeading('Suivi et communication', 'Parties prenantes, actions et échanges')}
    <div class="row g-4 reference-followup-layout">
      <div class="col-12 col-xl-7">
        <div class="card h-100">
          <div class="card-header">Actions demandées aux parties prenantes</div>
          <div class="table-responsive"><table class="table table-enterprise reference-actions-table">
            <thead><tr><th scope="col">Projet</th><th scope="col">Action</th><th scope="col">Destinataire</th><th scope="col">Échéance</th><th scope="col">Suivi</th></tr></thead>
            <tbody>${actions}</tbody>
          </table></div>
        </div>
      </div>
      <div class="col-12 col-xl-5">
        <div class="card h-100">
          <div class="card-header">Nouveau message</div>
          <div class="card-body">
            <form data-form="reference-message">
              <div class="mb-3"><label class="form-label" for="reference-message-project">Projet</label><select class="form-select" id="reference-message-project" name="projectSlug" required>${projects}</select></div>
              <div class="mb-3"><label class="form-label" for="reference-message-recipient">Destinataire</label><select class="form-select" id="reference-message-recipient" name="recipient" required>${recipients}</select></div>
              <div class="mb-3"><label class="form-label" for="reference-message-type">Type</label><select class="form-select" id="reference-message-type" name="type"><option>Demande de situation</option><option>Relance</option><option>Notification de décision</option><option>Convocation de réunion</option></select></div>
              <div class="mb-3"><label class="form-label" for="reference-message-subject">Objet</label><input class="form-control" id="reference-message-subject" name="subject" aria-required="true"></div>
              <div class="mb-3"><label class="form-label" for="reference-message-body">Message</label><textarea class="form-control" id="reference-message-body" name="message" rows="3"></textarea></div>
              <button class="btn btn-primary" type="submit">Enregistrer et envoyer (démonstration)</button>
            </form>
            <p class="small text-muted mt-3 mb-0">Aucun message n’est réellement envoyé dans ce prototype.</p>
          </div>
        </div>
      </div>
    </div>
    <div class="card mt-4">
      <div class="card-header">Journal des échanges</div>
      <div class="table-responsive"><table class="table table-enterprise reference-journal-table">
        <thead><tr><th scope="col">Date</th><th scope="col">Projet</th><th scope="col">Destinataire</th><th scope="col">Type</th><th scope="col">Objet</th><th scope="col">État</th></tr></thead>
        <tbody>${journal || '<tr><td colspan="6"><div class="empty-state">Aucun échange enregistré pour le moment.</div></td></tr>'}</tbody>
      </table></div>
      <div class="reference-portfolio-footnote">Chaque échange est rattaché à un projet et à une partie prenante, pour garder une trace opposable.</div>
    </div>`;
}

function messagesPage() {
  if (['direction', 'pmo'].includes(roleKeyFor(state.user))) return referenceFollowupPage();
  const visible = conversations.filter((conversation) => scopedProjectIds().has(conversation.projectId));
  if (!visible.some((conversation) => conversation.id === state.selectedConversation)) state.selectedConversation = visible[0]?.id;
  const selected = visible.find((conversation) => conversation.id === state.selectedConversation);
  const messages = selected ? (state.messages[selected.id] || selected.messages) : [];
  return `${pageHeading('Communication', 'Échanges contextualisés par projet · messages locaux de démonstration')}${demoBanner()}
    <div class="card"><div class="card-body p-0"><div class="row g-0">
      <div class="col-md-4 conversation-list">
        <div class="p-3 border-bottom"><input class="form-control form-control-sm" data-conversation-search placeholder="Rechercher une conversation…" aria-label="Rechercher une conversation"></div>
        ${visible.map((conversation) => `<div class="conversation-item ${selected?.id === conversation.id ? 'active' : ''}" data-conversation-id="${escapeHTML(conversation.id)}"><span class="avatar-initials">${escapeHTML(initials(conversation.participants[0]))}</span><span><span class="conversation-title d-block">${escapeHTML(conversation.title)}</span><span class="conversation-meta">${escapeHTML(conversation.participants.join(' · '))}</span></span>${conversation.unread ? `<span class="badge bg-primary rounded-pill ms-auto">${conversation.unread}</span>` : ''}</div>`).join('') || '<div class="empty-state">Aucune discussion dans votre périmètre.</div>'}
      </div>
      <div class="col-md-8">
        <div class="d-flex align-items-center justify-content-between border-bottom p-3"><div><strong class="small">${escapeHTML(selected?.title || 'Discussion projet')}</strong><span class="d-block small text-muted">${escapeHTML(selected?.participants.join(' · ') || '')}</span></div>${selected ? `<button class="btn btn-sm btn-outline-secondary" data-project-id="${escapeHTML(selected.projectId)}">Ouvrir le projet</button>` : ''}</div>
        <div class="p-3" style="min-height:320px;max-height:460px;overflow:auto" data-message-list>${messages.map((message) => `<div class="message-bubble ${message.author === state.user.name ? 'mine' : ''}"><span class="message-author">${escapeHTML(message.author)}</span><span>${escapeHTML(message.text)}</span>${message.attachment ? `<span class="badge bg-label-secondary d-block mt-2"><i class="bx bx-paperclip me-1"></i>${escapeHTML(message.attachment)}</span>` : ''}<span class="message-time">${escapeHTML(message.time)}</span></div>`).join('') || '<div class="empty-state">Aucun message.</div>'}</div>
        <form class="border-top p-3" data-form="message-send">
          <div class="input-group"><input class="form-control" name="message" placeholder="Écrire un message lié au projet…" required ${selected ? '' : 'disabled'}><button class="btn btn-primary" type="submit" ${selected ? '' : 'disabled'}><i class="bx bx-send me-1"></i>Envoyer</button></div>
          <div class="d-flex flex-wrap align-items-center gap-3 small text-muted mt-2"><label class="btn btn-sm btn-outline-secondary mb-0"><i class="bx bx-paperclip me-1"></i>Joindre un fichier<input class="visually-hidden" type="file" name="attachment" data-message-attachment></label><span data-chat-attachment-label>${escapeHTML(state.pendingMessageAttachment || 'Aucun fichier sélectionné')}</span><button class="btn btn-link btn-sm p-0" type="button" data-action="mention">Mentionner un participant</button><span><i class="bx bx-check-circle me-1"></i>Historique local</span></div><div class="mt-2" data-chat-attachment-preview></div>
        </form>
      </div>
    </div></div></div>`;
}

function reportsPage() {
  const scoped = allScopedProjects();
  const reports = [
    ['Vue exécutive du portefeuille', 'Synthèse de l’avancement, des risques majeurs et des arbitrages.', 'bx-pie-chart-alt-2', 'portfolio-report'],
    ['Rapport d’avancement projet', 'Avancement physique, délais contractuels et jalons.', 'bx-trending-up', 'progress-report'],
    ['Rapport financier', 'AE, crédits de paiement, engagements et situations.', 'bx-wallet', 'financial-report'],
    ['Rapport retards & délais', 'Dérives contractuelles, prévisions et plans de rattrapage.', 'bx-time-five', 'delay-report'],
    ['Rapport risques & blocages', 'Emprises, réseaux, arrêts et décisions en attente.', 'bx-error-circle', 'risk-report'],
    ['Rapport KPI', 'Indicateurs visibles selon la matrice de rôles.', 'bx-bar-chart-alt-2', 'kpis'],
    ['Synthèse des alertes', 'Événements et actions correctives dans le périmètre.', 'bx-bell', 'alerts'],
    ['Répartition géographique', 'Projets, secteurs et wilayas autorisés.', 'bx-map', 'map']
  ];
  const period = state.reportPeriod || '12 derniers mois';
  const seriesByPeriod = {
    '12 derniers mois': [32, 36, 39, 42, 44, 46, 49, 51, 53, 56, 57, 58],
    '6 derniers mois': [46, 49, 51, 53, 56, 58],
    'Année en cours': [42, 44, 49, 51, 56, 58]
  };
  const labelsByPeriod = {
    '12 derniers mois': ['Déc.', 'Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.'],
    '6 derniers mois': ['Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.'],
    'Année en cours': ['Janv.', 'Mars', 'Mai', 'Juil.', 'Sept.', 'Nov.']
  };
  const series = seriesByPeriod[period] || seriesByPeriod['12 derniers mois'];
  return `
    ${pageHeading('Rapports & analyses', 'Vues d’aide à la décision · filtres limités au périmètre autorisé', '<button class="btn btn-outline-secondary btn-sm" data-export="portfolio-report"><i class="bx bx-download me-1"></i>Exporter synthèse CSV</button>')}
    ${demoBanner()}
    <div class="row g-4 mb-4">${reports.map(([title, description, iconName, action]) => {
    const navigates = ['kpis', 'alerts', 'map'].includes(action);
    return `<div class="col-md-6 col-xl-3"><div class="card report-card" ${navigates ? `data-nav="${action}"` : `data-export="${action}"`}><div class="card-body"><span class="metric-icon"><i class="bx ${iconName}"></i></span><h6 class="mt-3 mb-2">${escapeHTML(title)}</h6><p class="small text-muted">${escapeHTML(description)}</p><span class="btn btn-sm btn-outline-primary">${navigates ? 'Ouvrir la vue' : 'Générer le rapport'} <i class="bx bx-right-arrow-alt ms-1"></i></span></div></div></div>`;
  }).join('')}</div>
    <div class="row g-4">
      <div class="col-xl-8"><div class="card">
        <div class="card-header d-flex justify-content-between"><span>Synthèse illustrative du périmètre</span><select class="form-select form-select-sm" style="width:auto" data-report-period>${Object.keys(seriesByPeriod).map((option) => `<option ${period === option ? 'selected' : ''}>${option}</option>`).join('')}</select></div>
        <div class="card-body">${lineChart(`Avancement physique consolidé · ${period}`, series, labelsByPeriod[period] || labelsByPeriod['12 derniers mois'])}<div class="row g-3 mt-2">${kpiMetric('AV2')}${kpiMetric('DL3')}${kpiMetric('FI4')}${kpiMetric('CO6')}</div></div>
      </div></div>
      <div class="col-xl-4"><div class="card h-100">
        <div class="card-header">Périmètre de ce rapport</div><div class="card-body">
          <div class="project-fact"><span>Projets</span><strong>${scoped.length} projets accessibles</strong></div>
          <div class="project-fact"><span>Budget révisé</span><strong>${money(sum(scoped, (project) => project.budgetRevised))}</strong></div>
          <div class="project-fact"><span>Rôle</span><strong>${escapeHTML(role().name)}</strong></div>
          <div class="project-fact"><span>Source</span><strong>Référentiel TAQADDUM · données fictives</strong></div>
          <div class="access-note mt-3">Les exports sont générés dans le navigateur et n’incluent que les données autorisées au rôle connecté.</div>
        </div>
      </div></div>
    </div>`;
}

function notificationsPage() {
  const instances = currentInstances().slice(0, 8);
  const allNotices = [
    ...instances.map((instance) => ({ id: instance.id, title: `${instance.ruleId} · ${alertRule(instance.ruleId)?.Nom}`, detail: `${projectById(instance.projectId)?.shortName} · ${instance.values}`, date: instance.detected, icon: 'bx-bell', nav: 'alerts' })),
    ...state.fieldReports.filter((report) => scopedProjectIds().has(report.projectId)).slice(0, 3).map((report) => ({ id: report.id, title: 'Rapport terrain enregistré', detail: `${projectById(report.projectId)?.shortName} · ${report.status}`, date: report.date, icon: 'bx-file', nav: 'field' })),
    ...visibleDocuments().slice(0, 2).map((document) => ({ id: document.name, title: 'Document disponible', detail: `${document.name} · ${projectById(document.projectId)?.shortName}`, date: document.date, icon: 'bx-folder-open', nav: 'documents' }))
  ].sort((a, b) => b.date.localeCompare(a.date));
  return `${pageHeading('Notifications', 'Alertes attribuées, rapports de terrain et documents visibles dans votre périmètre')}${demoBanner()}<div class="card"><div class="card-header d-flex justify-content-between"><span>Activité récente</span><button class="btn btn-sm btn-link" data-action="mark-read">Tout marquer comme lu</button></div><div class="card-body">${allNotices.map((notice) => `<button class="alert-row clickable w-100 text-start bg-transparent border-0" data-nav="${escapeHTML(notice.nav)}" data-notification-id="${escapeHTML(notice.id)}"><span class="metric-icon"><i class="bx ${notice.icon}"></i></span><span class="alert-row-content"><strong>${escapeHTML(notice.title)}</strong><span>${escapeHTML(notice.detail)} · ${shortDate(notice.date)}</span></span>${state.notificationsRead.includes(notice.id) ? '<span class="badge bg-label-secondary">Lue</span>' : '<span class="badge bg-label-primary">Nouvelle</span>'}</button>`).join('') || '<div class="empty-state">Aucune notification visible.</div>'}</div></div>`;
}

function showUploadModal() {
  showModal(`<div class="modal-header"><h5 class="modal-title">Ajouter un document au dossier</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><form data-form="document-upload"><div class="modal-body"><div class="alert alert-info py-2 small">Ajout simulé : seuls les métadonnées sont conservées dans le navigateur. Aucun document n’est transmis à un serveur.</div><div class="mb-3"><label class="form-label">Projet</label><select class="form-select" name="projectId" required>${allScopedProjects().map((project) => `<option value="${escapeHTML(project.id)}">${escapeHTML(project.shortName)}</option>`).join('')}</select></div><div class="mb-3"><label class="form-label">Catégorie</label><select class="form-select" name="category">${['Rapports', 'Études techniques', 'Financier', 'Terrain', 'Comptes rendus', 'Avenants', 'Réception'].map((item) => `<option>${item}</option>`).join('')}</select></div><div><label class="form-label">Fichier</label><input class="form-control" name="file" type="file" required></div></div><div class="modal-footer"><button class="btn btn-outline-secondary" type="button" data-bs-dismiss="modal">Annuler</button><button class="btn btn-primary" type="submit">Ajouter au dossier</button></div></form>`);
}

function kpiCatalogPage() {
  const allowed = visibleKPIs();
  const family = state.kpiFilters.family || '';
  const importance = state.kpiFilters.importance || '';
  const phase = state.kpiFilters.phase || '';
  const statusFilter = state.kpiFilters.status || '';
  const responsible = state.kpiFilters.responsible || '';
  const projectId = state.kpiFilters.project || '';
  const currentProject = scopedProjectIds().has(projectId) ? projectById(projectId) : null;
  const query = state.globalSearch.toLowerCase();
  const reportingDate = state.kpiFilters.reportingDate || '2026-11';
  const hasSnapshot = reportingDate === '2026-11';
  const filtered = (hasSnapshot ? allowed : []).filter((item) => {
    const value = valueFor(item, currentProject);
    return (!family || item.Famille === family) &&
      (!importance || item.Importance === importance) &&
      (!phase || item.Phase === phase) &&
      (!responsible || item.Responsable === responsible) &&
      (!statusFilter || statusFor(item, value, currentProject) === statusFilter) &&
      (!query || `${item.KPI_ID} ${item.Nom_KPI}`.toLowerCase().includes(query));
  });
  const rows = filtered.map((item) => {
    const value = valueFor(item, currentProject);
    const status = statusFor(item, value, currentProject);
    const permission = rolePermission('kpis', item.KPI_ID);
    return `<tr><td><span class="kpi-id">${escapeHTML(item.KPI_ID)}</span></td><td><button class="btn btn-link p-0 text-start kpi-name" data-kpi-id="${escapeHTML(item.KPI_ID)}">${escapeHTML(item.Nom_KPI)}<small>${escapeHTML(item.Famille)}</small></button></td><td>${importanceBadge(item.Importance)}</td><td>${escapeHTML(item.Phase)}</td><td class="fw-semibold">${escapeHTML(formatValue(item, value))}</td><td>${statusPill(status)}</td><td>${escapeHTML(permission)}</td><td>${escapeHTML(item.Fréquence_cible || '')}</td></tr>`;
  }).join('');
  const familyOptions = [...new Set(allowed.map((item) => item.Famille))];
  const responsibleOptions = [...new Set(allowed.map((item) => item.Responsable).filter(Boolean))];
  return `${pageHeading('KPI & performance', `${allowed.length} KPI visibles pour ${role().name} · droits issus de la matrice TAQADDUM`, `<button class="btn btn-outline-secondary btn-sm" data-export="kpis"><i class="bx bx-download me-1"></i>Exporter CSV</button>`)}${demoBanner()}<div class="card"><div class="card-header"><div class="d-flex flex-wrap align-items-center justify-content-between gap-3"><div><strong>Catalogue des indicateurs</strong><span class="text-muted small ms-2">${filtered.length} résultat(s) · reporting ${escapeHTML(reportingDate)}</span></div><div class="kpi-filter-grid"><input class="form-control form-control-sm" data-kpi-search placeholder="Rechercher un KPI…" value="${escapeHTML(state.globalSearch)}" aria-label="Rechercher un KPI"><select class="form-select form-select-sm" name="kpi-family" aria-label="Famille"><option value="">Toutes les familles</option>${familyOptions.map((option) => `<option value="${escapeHTML(option)}" ${family === option ? 'selected' : ''}>${escapeHTML(option)}</option>`).join('')}</select><select class="form-select form-select-sm" name="kpi-importance" aria-label="Importance"><option value="">Toutes importances</option>${['[M]', '[A]', '[S]'].map((option) => `<option ${importance === option ? 'selected' : ''}>${option}</option>`).join('')}</select><select class="form-select form-select-sm" name="kpi-phase" aria-label="Phase"><option value="">Toutes phases</option>${['MVP', 'V2', 'Vision'].map((option) => `<option ${phase === option ? 'selected' : ''}>${option}</option>`).join('')}</select><select class="form-select form-select-sm" name="kpi-responsible" aria-label="Responsable KPI"><option value="">Tous responsables</option>${responsibleOptions.map((option) => `<option ${responsible === option ? 'selected' : ''}>${escapeHTML(option)}</option>`).join('')}</select><select class="form-select form-select-sm" name="kpi-status" aria-label="Statut"><option value="">Tous statuts</option><option value="green" ${statusFilter === 'green' ? 'selected' : ''}>VERT</option><option value="orange" ${statusFilter === 'orange' ? 'selected' : ''}>ORANGE</option><option value="red" ${statusFilter === 'red' ? 'selected' : ''}>ROUGE</option><option value="info" ${statusFilter === 'info' ? 'selected' : ''}>Information</option></select><select class="form-select form-select-sm" name="kpi-project" aria-label="Projet"><option value="">Valeur ${state.user.scope === 'national' ? 'portefeuille' : 'périmètre'}</option>${allScopedProjects().map((project) => `<option value="${escapeHTML(project.id)}" ${projectId === project.id ? 'selected' : ''}>${escapeHTML(project.shortName)}</option>`).join('')}</select><input class="form-control form-control-sm" type="month" value="${escapeHTML(reportingDate)}" name="kpi-reporting-date" aria-label="Date de reporting"></div></div><div class="d-flex flex-wrap gap-2 mt-3"><span class="small text-muted">Droits :</span><span class="badge bg-label-primary">R · responsable</span><span class="badge bg-label-info">S · alimente</span><span class="badge bg-label-secondary">V · consultation</span><span class="small text-muted ms-auto">${hasSnapshot ? 'Valeurs illustratives disponibles pour novembre 2026 uniquement.' : 'Aucune donnée illustrative disponible pour cette période ; les valeurs ne sont pas extrapolées.'}</span></div></div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>ID</th><th>Indicateur</th><th>Importance</th><th>Phase</th><th>Valeur illustrative</th><th>État seuil</th><th>Mon droit</th><th>Fréquence</th></tr></thead><tbody>${rows || `<tr><td colspan="8"><div class="empty-state">${hasSnapshot ? 'Aucun KPI ne correspond aux filtres.' : 'Aucun point de reporting disponible pour la période sélectionnée.'}</div></td></tr>`}</tbody></table></div></div>`;
}

function alertsPage() {
  const allowedRules = visibleAlertRules();
  const visible = currentInstances();
  const statusFilter = state.alertFilters.status || '';
  const severityFilter = state.alertFilters.severity || '';
  const query = (state.alertFilters.query || '').trim().toLowerCase();
  const rows = visible.filter((instance) => {
    const rule = alertRule(instance.ruleId);
    const currentStatus = state.alertChanges[instance.id]?.status || instance.status;
    return (!statusFilter || currentStatus === statusFilter) &&
      (!severityFilter || rule?.Niveau === severityFilter) &&
      (!query || `${rule?.Nom} ${instance.projectId} ${projectById(instance.projectId)?.name} ${instance.ruleId}`.toLowerCase().includes(query));
  }).map((instance) => alertTableRow(instance)).join('');
  const rulesRows = allowedRules.map((item) => `<tr><td><span class="kpi-id">${escapeHTML(item.Regle_ID)}</span></td><td><button class="btn btn-link p-0 text-start kpi-name" data-rule-id="${escapeHTML(item.Regle_ID)}">${escapeHTML(item.Nom)}</button><small class="d-block text-muted mt-1">${escapeHTML(alertCondition(item))}</small></td><td>${statusPill(item.Niveau === 'ROUGE' ? 'red' : 'orange', item.Niveau)}</td><td>${importanceBadge(item.Importance)}</td><td>${escapeHTML(item.Phase || '')}</td><td>${escapeHTML(item.Destinataire || '')}</td><td>${escapeHTML(item.Action || '')}</td><td>${escapeHTML(item['Fréquence'] || '')}</td></tr>`).join('');
  const instancesTab = state.alertTab === 'instances';
  return `${pageHeading('Risques & alertes', `${visible.length} événements illustratifs · ${allowedRules.length} règles autorisées par la matrice`, `<span class="role-chip"><i class="bx bx-shield-quarter"></i>${escapeHTML(role().name)}</span>`)}${demoBanner()}<div class="card"><div class="card-header pb-0"><div class="d-flex flex-wrap align-items-center justify-content-between gap-2"><div><strong>Centre des alertes</strong><span class="text-muted small ms-2">Signal d’aide à la décision · validation institutionnelle requise</span></div><div class="nav nav-pills"><button class="nav-link ${instancesTab ? 'active' : ''}" data-alert-tab="instances">Événements (${visible.length})</button><button class="nav-link ${!instancesTab ? 'active' : ''}" data-alert-tab="rules">Règles (${allowedRules.length})</button></div></div></div>${instancesTab ? `<div class="card-body pb-2"><div class="toolbar"><input class="form-control form-control-sm" name="alert-query" placeholder="Projet, alerte, identifiant…" value="${escapeHTML(query)}"><select class="form-select form-select-sm" name="alert-severity"><option value="">Toutes sévérités</option><option value="ROUGE" ${severityFilter === 'ROUGE' ? 'selected' : ''}>ROUGE</option><option value="ORANGE" ${severityFilter === 'ORANGE' ? 'selected' : ''}>ORANGE</option></select><select class="form-select form-select-sm" name="alert-status"><option value="">Tous les statuts</option>${['Nouvelle', 'À traiter', 'En cours', 'En attente', 'Escaladée', 'Résolue', 'Clôturée'].map((value) => `<option ${statusFilter === value ? 'selected' : ''}>${value}</option>`).join('')}</select><span class="ms-auto small text-muted">${currentInstances().filter((instance) => ['Fiable', 'Partielle', 'À vérifier', 'Insuffisante'].includes(instance.confidence)).length} événements · confiance à vérifier au cas par cas</span></div></div><div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>ID / sévérité</th><th>Alerte</th><th>Projet</th><th>Détectée le</th><th>Valeurs déclenchantes</th><th>Fiabilité</th><th>Responsable</th><th>État</th></tr></thead><tbody>${rows || '<tr><td colspan="8"><div class="empty-state">Aucun événement ne correspond à vos filtres.</div></td></tr>'}</tbody></table></div>` : `<div class="table-responsive"><table class="table table-enterprise"><thead><tr><th>ID</th><th>Règle & condition</th><th>Niveau</th><th>Importance</th><th>Phase</th><th>Destinataires</th><th>Action attendue</th><th>Fréquence</th></tr></thead><tbody>${rulesRows || '<tr><td colspan="8"><div class="empty-state">Aucune règle visible selon la matrice de rôles.</div></td></tr>'}</tbody></table></div>`}</div><div class="row g-4 mt-1"><div class="col-md-4"><div class="card"><div class="card-body d-flex align-items-center gap-3"><span class="metric-icon text-danger"><i class="bx bx-error-circle"></i></span><div><strong>${visible.filter((instance) => alertRule(instance.ruleId)?.Niveau === 'ROUGE').length}</strong><span class="d-block small text-muted">Alertes ROUGE visibles</span></div></div></div></div><div class="col-md-4"><div class="card"><div class="card-body d-flex align-items-center gap-3"><span class="metric-icon text-warning"><i class="bx bx-error"></i></span><div><strong>${visible.filter((instance) => alertRule(instance.ruleId)?.Niveau === 'ORANGE').length}</strong><span class="d-block small text-muted">Alertes ORANGE visibles</span></div></div></div></div><div class="col-md-4"><div class="card"><div class="card-body d-flex align-items-center gap-3"><span class="metric-icon"><i class="bx bx-data"></i></span><div><strong>${visible.filter((instance) => ['À vérifier', 'Insuffisante'].includes(instance.confidence)).length}</strong><span class="d-block small text-muted">Vérification de données nécessaire</span></div></div></div></div></div>`;
}

function ruleKpiIds(rule) {
  const raw = [rule?.C1_KPI_ou_champ, rule?.C2_KPI_ou_champ, rule?.C3_KPI_ou_champ].filter(Boolean).join(' ');
  return [...new Set(raw.match(/\b(?:AV|FI|DL|BU|QR|DO|PP|CO|GV)\d\b/g) || [])];
}

function ruleThresholds(rule) {
  return [1, 2, 3].map((number) => ({
    field: rule?.[`C${number}_KPI_ou_champ`],
    operator: rule?.[`C${number}_Op`],
    threshold: rule?.[`C${number}_Seuil`]
  })).filter((condition) => condition.field);
}

function alertTableRow(instance) {
  const rule = alertRule(instance.ruleId);
  const project = projectById(instance.projectId);
  const change = state.alertChanges[instance.id] || {};
  const status = change.status || instance.status;
  const action = rolePermission('alerts', instance.ruleId) === 'D';
  return `<tr class="clickable" data-alert-id="${escapeHTML(instance.id)}"><td><span class="kpi-id">${escapeHTML(instance.ruleId)}</span><div class="mt-1">${statusPill(rule?.Niveau === 'ROUGE' ? 'red' : 'orange', rule?.Niveau || '')}</div></td><td class="primary-cell">${escapeHTML(rule?.Nom || '')}</td><td><button class="btn btn-link p-0 text-start small" data-project-id="${escapeHTML(project?.id || '')}">${escapeHTML(project?.shortName || '')}</button><small class="d-block text-muted">${escapeHTML(project?.wilaya || '')}</small></td><td>${shortDate(instance.detected)}</td><td>${escapeHTML(instance.values)}</td><td>${statusPill(instance.confidence === 'Fiable' ? 'green' : instance.confidence === 'Insuffisante' ? 'red' : 'orange', instance.confidence)}</td><td>${escapeHTML(change.assignee || instance.assignee)}</td><td>${escapeHTML(status)}${action ? '<i class="bx bx-edit-alt ms-1 text-primary"></i>' : ''}</td></tr>`;
}

function alertRow(instance) {
  const rule = alertRule(instance.ruleId);
  return `<div class="alert-row clickable" data-alert-id="${escapeHTML(instance.id)}"><span class="alert-severity ${rule?.Niveau === 'ORANGE' ? 'orange' : ''}"></span><span class="alert-row-content"><strong>${escapeHTML(instance.ruleId)} · ${escapeHTML(rule?.Nom || '')}</strong><span>${escapeHTML(instance.values)} · ${escapeHTML(instance.status)}</span></span></div>`;
}

function render() {
  disposeLeafletMaps();
  if (!state.user) {
    renderLogin();
    return;
  }
  if (!roles[roleKeyFor(state.user)]) {
    state.user = null;
    localStorage.removeItem('cned-demo-user');
    sessionStorage.removeItem('cned-demo-session');
    renderLogin();
    return;
  }
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
  document.body.classList.add('layout-menu-fixed');
  app.innerHTML = shell();
  renderCurrentPage();
}

const searchNormalize = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const searchHighlight = (text, tokens) => {
  const source = String(text ?? '');
  const plain = searchNormalize(source);
  const ranges = [];
  tokens.forEach((token) => {
    const at = plain.indexOf(token);
    if (at >= 0) ranges.push([at, at + token.length]);
  });
  if (!ranges.length) return escapeHTML(source);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  ranges.forEach((range) => {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  });
  let out = '';
  let cursor = 0;
  merged.forEach(([from, to]) => {
    out += `${escapeHTML(source.slice(cursor, from))}<mark>${escapeHTML(source.slice(from, to))}</mark>`;
    cursor = to;
  });
  return out + escapeHTML(source.slice(cursor));
};

// Recherche globale : s'appuie uniquement sur les jeux de données existants de l'application
// (projets du périmètre de l'utilisateur + fiches de référence pour Direction / PMO).
function searchEntries() {
  const entries = allScopedProjects().map((project) => ({
    kind: 'project', key: project.id, name: project.name, ref: project.id,
    meta: [project.sector, project.wilaya].filter(Boolean).join(' · '),
    status: project.status, statusClass: projectStatusClass(project.status),
    hay: [project.name, project.shortName, project.id, project.sector, project.wilaya, project.owner, project.contractor, project.bet].join(' ')
  }));
  if (['direction', 'pmo'].includes(roleKeyFor(state.user))) {
    referenceProjects.forEach((project) => {
      const status = referenceStatus(project);
      entries.push({
        kind: 'reference', key: project.slug, name: project.name, ref: project.id,
        meta: [project.sector, project.wilayas.join(', ')].filter(Boolean).join(' · '),
        status, statusClass: status === 'À l’arrêt' ? 'red' : status === 'En retard' ? 'orange' : 'green',
        hay: [project.name, project.id, project.slug, project.sector, project.wilayas.join(' '), project.contractor, project.bet, project.control, project.observation].join(' ')
      });
    });
  }
  return entries;
}

function searchResults(query) {
  const tokens = searchNormalize(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return { tokens, projects: [], kpis: [] };
  const projectsFound = searchEntries()
    .map((entry) => {
      const hay = searchNormalize(entry.hay);
      if (!tokens.every((token) => hay.includes(token))) return null;
      const name = searchNormalize(entry.name);
      const rank = name.startsWith(tokens[0]) ? 0 : tokens.every((token) => name.includes(token)) ? 1 : searchNormalize(entry.ref).includes(tokens[0]) ? 2 : 3;
      return { entry, rank };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank || a.entry.name.localeCompare(b.entry.name, 'fr'))
    .map((item) => item.entry);
  const kpisFound = visibleKPIs().filter((item) => {
    const hay = searchNormalize(`${item.KPI_ID} ${item.Nom_KPI}`);
    return tokens.every((token) => hay.includes(token));
  });
  return { tokens, projects: projectsFound, kpis: kpisFound };
}

function renderSearchResults(query) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return '';
  const { tokens, projects: found, kpis: kpiFound } = searchResults(trimmed);
  if (!found.length && !kpiFound.length) {
    return `<div class="search-empty" role="status">Aucun projet ne correspond à « ${escapeHTML(trimmed)} ».</div>`;
  }
  const attr = (entry) => entry.kind === 'reference' ? `data-reference-project="${escapeHTML(entry.key)}"` : `data-project-id="${escapeHTML(entry.key)}"`;
  const shown = found.slice(0, 8);
  const projectItems = shown.map((entry) => `<button type="button" class="search-item" role="option" ${attr(entry)}><span class="search-item-main"><strong>${searchHighlight(entry.name, tokens)}</strong><small>${searchHighlight(entry.ref, tokens)}${entry.meta ? ` · ${searchHighlight(entry.meta, tokens)}` : ''}</small></span>${statusPill(entry.statusClass, entry.status)}</button>`).join('');
  const kpiItems = kpiFound.slice(0, 3).map((item) => `<button type="button" class="search-item" role="option" data-kpi-id="${escapeHTML(item.KPI_ID)}"><span class="search-item-main"><strong>${searchHighlight(item.Nom_KPI, tokens)}</strong><small>${escapeHTML(item.KPI_ID)} · ${escapeHTML(item.Famille || '')}</small></span><span class="badge bg-label-secondary">KPI</span></button>`).join('');
  const more = found.length > shown.length ? `<button type="button" class="search-all" data-search-all="${escapeHTML(trimmed)}">Voir les ${found.length} projets dans le portefeuille</button>` : '';
  return `${found.length ? `<div class="search-group">Projets · ${found.length}</div>${projectItems}${more}` : ''}${kpiFound.length ? `<div class="search-group">Indicateurs · ${kpiFound.length}</div>${kpiItems}` : ''}`;
}

function updateSearchResults(form) {
  const input = form?.querySelector('[name="query"]');
  const panel = form?.querySelector('[data-search-results]');
  if (!input || !panel) return;
  const html = renderSearchResults(input.value);
  panel.innerHTML = html;
  panel.hidden = !html;
  input.setAttribute('aria-expanded', String(Boolean(html)));
}

function closeSearchResults() {
  document.querySelectorAll('[data-search-results]').forEach((panel) => { panel.hidden = true; });
  document.querySelectorAll('.navbar-search [name="query"]').forEach((input) => input.setAttribute('aria-expanded', 'false'));
}

function moveSearchSelection(form, delta) {
  const items = [...form.querySelectorAll('.search-item')];
  if (!items.length) return;
  const current = items.findIndex((item) => item.classList.contains('active'));
  items.forEach((item) => item.classList.remove('active'));
  const next = items[(current + delta + items.length) % items.length];
  next.classList.add('active');
  next.scrollIntoView({ block: 'nearest' });
}

// Décor du menu latéral : fins traits lumineux (éclairs) qui traversent et s'effacent, derrière le texte.
function menuSquares() {
  const bolts = [[8, 10, 90, -14], [24, 38, 70, 10], [42, 4, 110, -8], [56, 52, 80, 16], [70, 20, 100, -18], [86, 46, 76, 8], [16, 66, 96, -10], [48, 78, 84, 14], [76, 70, 104, -6], [92, 90, 72, 12]];
  return `<div class="menu-squares" aria-hidden="true">${bolts.map(([x, y, length, angle], index) => `<i style="--x:${x}%;--y:${y}%;--l:${length}px;--a:${angle}deg;--d:${((index * 1.61) % 8).toFixed(2)}s;--t:${(5.5 + (index % 4) * 1.2).toFixed(1)}s"></i>`).join('')}</div>`;
}

function shell() {
  const config = role();
  const notificationCount = Math.min(9, currentInstances().filter((instance) => !state.notificationsRead.includes(instance.id)).length);
  const roleNav = config.nav.map((page) => {
    const [label, iconName] = pageMeta[page];
    const executiveRole = ['direction', 'pmo'].includes(roleKeyFor(state.user));
    const navLabel = page === 'messages' && executiveRole ? 'Suivi et communication' : label;
    const active = page === state.page || (state.page === 'project' && page === 'portfolio');
    return `<li class="menu-item ${active ? 'active' : ''}"><a class="menu-link" data-nav="${page}"><i class="menu-icon tf-icons bx ${iconName}"></i><div>${escapeHTML(t(navLabel))}</div>${page === 'alerts' && currentInstances().length ? `<span class="badge badge-center rounded-pill bg-danger ms-auto">${currentInstances().length}</span>` : ''}</a></li>`;
  }).join('');
  return `<div class="layout-wrapper layout-content-navbar"><div class="layout-container"><aside id="layout-menu" class="layout-menu menu-vertical menu bg-menu-theme">${menuSquares()}<div class="app-brand demo shell-brand"><a class="app-brand-link" data-nav="dashboard" aria-label="TAQADDUM"><span class="brand-flag"><img class="shell-brand-logo" src="assets/img/taqaddum/logo.svg" width="46" height="46" alt="" decoding="async"><span class="app-brand-text demo menu-text ms-2">TAQADDUM</span></span></a><a href="javascript:void(0)" class="layout-menu-toggle menu-link text-large ms-auto d-block d-xl-none" aria-label="Fermer le menu"><i class="bx bx-chevron-left bx-sm align-middle"></i></a></div><div class="menu-inner-shadow"></div><div class="px-4 pb-2"><div class="role-chip w-100 justify-content-start"><i class="bx bx-shield-quarter"></i><span>${escapeHTML(config.name)}</span></div><small class="d-block text-muted mt-2 px-1">${escapeHTML(config.workspace)}</small></div><ul class="menu-inner py-1"><li class="menu-header small text-uppercase"><span class="menu-header-text">Espace de travail</span></li>${roleNav}<li class="menu-header small text-uppercase"><span class="menu-header-text">Session de démonstration</span></li><li class="menu-item"><a class="menu-link" data-action="logout"><i class="menu-icon tf-icons bx bx-log-out"></i><div>${escapeHTML(t('Déconnexion'))}</div></a></li></ul></aside><div class="layout-page"><nav class="layout-navbar container-xxl navbar navbar-expand-xl navbar-detached align-items-center bg-navbar-theme" id="layout-navbar"><div class="layout-menu-toggle navbar-nav align-items-xl-center me-3 me-xl-0 d-xl-none"><a class="nav-item nav-link px-0 me-xl-4" href="javascript:void(0)" aria-label="Ouvrir le menu"><i class="bx bx-menu bx-sm"></i></a></div><div class="navbar-nav-right d-flex align-items-center" id="navbar-collapse"><form class="navbar-search d-flex align-items-center" data-form="global-search" role="search"><i class="bx bx-search fs-4 lh-0 text-muted"></i><input type="search" class="form-control border-0 shadow-none ms-2" name="query" placeholder="${escapeHTML(t('Rechercher un projet ..'))}" aria-label="Rechercher un projet" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="global-search-results" value="${escapeHTML(state.globalSearch)}"><div class="search-results" id="global-search-results" role="listbox" data-search-results hidden></div></form><ul class="navbar-nav flex-row align-items-center ms-auto"><li class="nav-item me-2"><span class="role-chip d-none d-lg-inline-flex">${escapeHTML(config.workspace)}</span></li><li class="nav-item me-2"><button class="btn btn-sm btn-text-secondary" data-action="language" aria-label="Changer de langue">${state.lang === 'fr' ? 'عربي' : 'FR'}</button></li><li class="nav-item me-2"><button class="btn btn-sm btn-icon btn-text-secondary position-relative" data-nav="notifications" aria-label="Notifications"><i class="bx bx-bell bx-sm"></i>${notificationCount ? `<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">${notificationCount}</span>` : ''}</button></li><li class="nav-item navbar-dropdown dropdown-user dropdown"><a class="nav-link dropdown-toggle hide-arrow" href="javascript:void(0)" data-bs-toggle="dropdown"><div class="avatar avatar-online"><span class="avatar-initials">${escapeHTML(state.user.initials)}</span></div></a><ul class="dropdown-menu dropdown-menu-end"><li><a class="dropdown-item" href="javascript:void(0)"><span class="d-flex align-items-center"><span class="avatar-initials me-3">${escapeHTML(state.user.initials)}</span><span><strong class="d-block">${escapeHTML(state.user.name)}</strong><small class="text-muted">${escapeHTML(state.user.title)}</small></span></span></a></li><li><hr class="dropdown-divider"></li><li><a class="dropdown-item" href="javascript:void(0)"><i class="bx bx-building me-2"></i>${escapeHTML(state.user.organization)}</a></li><li><a class="dropdown-item" data-action="logout"><i class="bx bx-log-out me-2"></i>${escapeHTML(t('Déconnexion'))}</a></li></ul></li></ul></div></nav><div class="content-wrapper"><div class="container-xxl flex-grow-1 container-p-y" id="page-content"><div class="app-content-area"></div></div><footer class="content-footer footer bg-footer-theme"><div class="container-xxl py-2 footer-sway-wrap"><div class="footer-sway text-muted small">Tous droits réservés · CRAT 2026</div></div></footer><div class="content-backdrop fade"></div></div></div></div><div class="layout-overlay layout-menu-toggle"></div></div><div class="modal fade" id="detail-modal" tabindex="-1" aria-hidden="true"><div class="modal-dialog modal-dialog-centered modal-lg"><div class="modal-content"></div></div></div>`;
}

function renderCurrentPage() {
  const host = document.querySelector('.app-content-area');
  if (!host) return;
  disposeLeafletMaps();
  const selectedProject = projectById(state.projectId);
  const page = state.page === 'project' && selectedProject ? projectPage(selectedProject) : renderPageByKey(state.page);
  host.innerHTML = page;
  if (state.page === 'alerts' && ['direction', 'pmo'].includes(roleKeyFor(state.user))) {
    host.insertAdjacentHTML('beforeend', referenceAlertRegister());
  }
  bindMenuPlugin();
  initializeLeafletMaps(host);
}

function disposeLeafletMaps() {
  leafMaps.forEach(({ map, observer, toolbar }) => {
    observer?.disconnect();
    toolbar?.remove();
    map.remove();
  });
  leafMaps = [];
}

function renderPageByKey(page) {
  if (page === 'dashboard') return roleDashboard();
  if (page === 'reference-project') return referencePmoPage();
  if (page === 'reference-details') return referenceProjectDetailPage();
  if (page === 'portfolio') return portfolioPage();
  if (page === 'project') return portfolioPage();
  if (page === 'kpis') return kpiCatalogPage();
  if (page === 'alerts') return alertsPage();
  if (page === 'finance') return financePage();
  if (page === 'planning') return planningPage();
  if (page === 'technical') return technicalPage();
  if (page === 'field') return fieldPage();
  if (page === 'map') return mapPage();
  if (page === 'documents') return documentsPage();
  if (page === 'messages') return messagesPage();
  if (page === 'reports') return reportsPage();
  if (page === 'notifications') return notificationsPage();
  return `<div class="empty-state"><i class="bx bx-error-circle"></i>Cette section n’est pas disponible pour ce rôle.</div>`;
}

const BASEMAP_STORAGE_KEY = 'cned-basemap';

// Emprise de l'Algérie entière (sud, ouest, nord, est) : vue initiale de la carte nationale.
const ALGERIA_BOUNDS = [[18.9, -8.7], [37.2, 12.0]];

// Fonds de carte gratuits, sans clé d'API. Les tuiles OSM publiques (tile.openstreetmap.org) et les fonds CARTO
// sont volontairement exclus (« 403 Access blocked » / indisponibles depuis certains domaines de développement
// comme Codespaces). Le premier de la liste (ou le dernier choisi par l'utilisateur) est affiché ; en cas
// d'échec, la carte bascule automatiquement sur le suivant.
const osmCredit = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';
const basemapCatalog = [
  { id: 'esri-streets', label: 'Plan', icon: 'bx-map-alt', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', options: { maxZoom: 19, attribution: 'Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, and others' } },
  { id: 'esri-imagery', label: 'Satellite', borders: false, icon: 'bx-world', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', options: { maxZoom: 19, attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community' } },
  { id: 'opentopomap', label: 'Relief', icon: 'bx-landscape', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', options: { subdomains: 'abc', maxZoom: 17, attribution: `${osmCredit}, SRTM &mdash; &copy; <a href="https://opentopomap.org" target="_blank" rel="noopener noreferrer">OpenTopoMap</a> (CC-BY-SA)` } }
];

function availableBasemaps() {
  const list = [...basemapCatalog];
  // Fournisseur personnalisé facultatif (map-config.json généré par scripts/generate-map-config.mjs).
  if (mapConfig?.provider && mapConfig?.url) {
    const attribution = mapConfig.attributionUrl
      ? `<a href="${escapeHTML(mapConfig.attributionUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(mapConfig.attribution || mapConfig.provider)}</a>`
      : escapeHTML(mapConfig.attribution || mapConfig.provider);
    list.unshift({ id: 'custom', label: mapConfig.provider, borders: mapConfig.borders !== false, url: mapConfig.url, options: { maxZoom: mapConfig.maxZoom || 19, attribution } });
  }
  return list;
}

function readSavedBasemap() {
  try {
    return localStorage.getItem(BASEMAP_STORAGE_KEY);
  } catch (error) {
    return null;
  }
}

function saveBasemap(id) {
  try {
    localStorage.setItem(BASEMAP_STORAGE_KEY, id);
  } catch (error) {
    /* stockage indisponible : le choix ne sera simplement pas mémorisé */
  }
}

function setupBasemaps(leaflet, map, showStatus) {
  const catalog = availableBasemaps();
  const layers = new Map();
  const idByLayer = new Map();
  const failed = new Set();
  catalog.forEach((definition) => {
    const layer = leaflet.tileLayer(definition.url, { ...definition.options, crossOrigin: false });
    layers.set(definition.id, layer);
    idByLayer.set(layer, definition.id);
  });
  const savedId = readSavedBasemap();
  let activeId = layers.has(savedId) ? savedId : catalog[0].id;

  const listeners = [];
  const api = {
    catalog,
    getActive: () => activeId,
    // Fonds avec frontières (Plan, Relief) ou sans (Satellite) : sert à masquer le tracé du Sahara occidental.
    hasBorders: (id = activeId) => catalog.find((definition) => definition.id === id)?.borders !== false,
    subscribe: (listener) => { listeners.push(listener); }
  };
  const activate = (id) => {
    if (activeId && layers.get(activeId) && map.hasLayer(layers.get(activeId))) map.removeLayer(layers.get(activeId));
    activeId = id;
    layers.get(id).addTo(map);
    listeners.forEach((listener) => listener(id));
  };
  api.select = (id) => {
    if (!layers.has(id) || id === activeId) return;
    failed.delete(id);
    activate(id);
    saveBasemap(id);
  };

  const fallbackFrom = (id) => {
    failed.add(id);
    const next = catalog.find((definition) => !failed.has(definition.id));
    if (next) {
      activate(next.id);
      showStatus(`Fond de carte « ${catalog.find((d) => d.id === id).label} » indisponible : bascule automatique sur « ${next.label} ».`);
    } else {
      showStatus('Aucun fond de carte n’est joignable (vérifiez la connexion Internet). Les projets et les wilayas restent affichés.');
    }
  };

  layers.forEach((layer, id) => {
    let loaded = false;
    let errors = 0;
    layer.on('tileload', () => { loaded = true; });
    layer.on('tileerror', () => {
      errors += 1;
      if (!loaded && errors >= 4 && activeId === id && map.hasLayer(layer)) fallbackFrom(id);
    });
  });

  layers.get(activeId).addTo(map);
  return api;
}

// Barre d'outils placée au-dessus de la carte (fonds de carte + calques), à la place du contrôle
// Leaflet flottant qui masquait une partie de la carte.
function buildMapToolbar(map, element, basemaps, overlays) {
  element.parentElement?.querySelectorAll(':scope > .map-toolbar').forEach((node) => node.remove());
  const toolbar = document.createElement('div');
  toolbar.className = 'map-toolbar';
  const segmented = basemaps.catalog.map((definition) => `<button type="button" class="map-segment" data-basemap="${escapeHTML(definition.id)}" aria-pressed="false"><i class="bx ${escapeHTML(definition.icon || 'bx-map')}"></i><span>${escapeHTML(definition.label)}</span></button>`).join('');
  const chips = overlays.map((overlay, index) => `<button type="button" class="map-chip" data-overlay="${index}" aria-pressed="false" title="${escapeHTML(overlay.title || overlay.label)}"><span class="map-chip-dot" style="--chip:${escapeHTML(overlay.color)}"></span>${escapeHTML(overlay.label)}</button>`).join('');
  toolbar.innerHTML = `<div class="map-segmented" role="group" aria-label="Fond de carte">${segmented}</div><div class="map-chips" role="group" aria-label="Calques">${chips}</div>`;
  const refreshBasemaps = (activeId) => {
    toolbar.querySelectorAll('[data-basemap]').forEach((button) => {
      const on = button.dataset.basemap === activeId;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', String(on));
    });
  };
  const refreshOverlays = () => {
    toolbar.querySelectorAll('[data-overlay]').forEach((button) => {
      const on = map.hasLayer(overlays[Number(button.dataset.overlay)].layer);
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', String(on));
    });
  };
  toolbar.addEventListener('click', (event) => {
    const basemapButton = event.target.closest('[data-basemap]');
    if (basemapButton) {
      basemaps.select(basemapButton.dataset.basemap);
      return;
    }
    const overlayButton = event.target.closest('[data-overlay]');
    if (overlayButton) {
      const { layer } = overlays[Number(overlayButton.dataset.overlay)];
      if (map.hasLayer(layer)) map.removeLayer(layer);
      else layer.addTo(map);
      refreshOverlays();
    }
  });
  basemaps.subscribe(refreshBasemaps);
  refreshBasemaps(basemaps.getActive());
  refreshOverlays();
  element.insertAdjacentElement('beforebegin', toolbar);
  return toolbar;
}

function initializeLeafletMaps(root) {
  const leaflet = window.L;
  root.querySelectorAll('[data-leaflet-map]').forEach((element) => {
    if (!leaflet) {
      element.innerHTML = '<div class="empty-state py-4">La bibliothèque cartographique n’a pas pu être chargée.</div>';
      return;
    }
    const requestedProject = element.dataset.projectSlug ? referenceProjectBySlug(element.dataset.projectSlug) : null;
    const projectSlugs = element.dataset.projectList?.split(',').filter(Boolean);
    const visibleProjects = requestedProject
      ? [requestedProject]
      : projectSlugs
        ? referenceProjects.filter((project) => projectSlugs.includes(project.slug))
        : referenceProjects;
    const wilayaCodes = element.dataset.wilayaList?.split(',').filter(Boolean);
    const visibleWilayas = wilayaCodes
      ? wilayas.filter((item) => wilayaCodes.includes(item.code))
      : wilayas;
    const isMini = element.classList.contains('leaflet-mini-map');
    const map = leaflet.map(element, { scrollWheelZoom: false, zoomControl: !isMini, zoomSnap: isMini ? 1 : 0.25 });
    const providerStatus = leaflet.control({ position: 'topright' });
    let statusElement;
    providerStatus.onAdd = () => {
      statusElement = leaflet.DomUtil.create('div', 'map-provider-status leaflet-control');
      statusElement.setAttribute('role', 'status');
      statusElement.setAttribute('aria-live', 'polite');
      statusElement.hidden = true;
      return statusElement;
    };
    providerStatus.addTo(map);
    const showProviderStatus = (message) => {
      if (statusElement) {
        statusElement.textContent = message;
        statusElement.hidden = false;
      }
      const messageElement = element.closest('.card-body')?.querySelector('[data-map-message]');
      if (messageElement) messageElement.textContent = message;
    };
    const basemaps = setupBasemaps(leaflet, map, showProviderStatus);
    const wilayaLayer = leaflet.layerGroup();
    const statusLayers = {
      'Projets · En cours': leaflet.layerGroup(),
      'Projets · En retard / surveillance': leaflet.layerGroup(),
      'Projets · À l’arrêt': leaflet.layerGroup()
    };
    const criticalLayer = leaflet.layerGroup();
    const markerBySlug = new Map();
    visibleWilayas.forEach((wilaya) => {
      const projectRefs = visibleProjects.filter((project) => project.wilayas.includes(wilaya.name)).map((project) => project.id);
      const marker = leaflet.circleMarker([wilaya.lat, wilaya.lon], {
        radius: 3,
        color: '#315b76',
        weight: 1,
        fillColor: '#dce8ee',
        fillOpacity: 0.9
      });
      marker.bindPopup(`<strong>${escapeHTML(wilaya.code)} · ${escapeHTML(state.lang === 'ar' ? wilaya.nameAr : wilaya.name)}</strong><br><span>${escapeHTML(wilaya.region)} · repère indicatif</span><br><small>${projectRefs.length ? `${projectRefs.length} projet(s) de référence : ${escapeHTML(projectRefs.join(', '))}` : 'Aucun projet de référence dans cette wilaya.'}</small>`);
      wilayaLayer.addLayer(marker);
    });
    visibleProjects.forEach((project) => {
      const status = referenceStatus(project);
      const color = status === 'À l’arrêt' ? '#bf5550' : status === 'En retard' || status === 'À surveiller' ? '#c97b21' : '#428b6e';
      const marker = leaflet.circleMarker(project.coordinates, {
        radius: element.classList.contains('leaflet-mini-map') ? 6 : 8,
        color: '#fff',
        weight: 2,
        fillColor: color,
        fillOpacity: 1
      });
      marker.bindPopup(`<div class="leaflet-project-popup"><strong>${escapeHTML(project.name)}</strong><span>${escapeHTML(project.id)} · ${escapeHTML(project.sector)}</span><span>${escapeHTML(project.wilayas.join(', '))} · ${escapeHTML(status)}</span><span>Physique ${referenceNumber(project.physical, 1)} % · financier ${referenceNumber(project.financial, 1)} %</span><span>AE ${referenceNumber(project.aeCurrent)} Md DA · échéance ${escapeHTML(project.contractualEnd)}</span><span>${referenceAlerts(project).length} alerte(s)</span><button type="button" class="btn btn-sm btn-primary mt-2" data-reference-project="${project.slug}">Ouvrir la fiche projet</button></div>`);
      marker.on('click', () => {
        selectMapProject(project.slug, false);
      });
      const layerKey = status === 'À l’arrêt'
        ? 'Projets · À l’arrêt'
        : status === 'En retard' || status === 'À surveiller'
          ? 'Projets · En retard / surveillance'
          : 'Projets · En cours';
      statusLayers[layerKey].addLayer(marker);
      markerBySlug.set(project.slug, marker);
      if (referenceAlerts(project).some((alert) => alert.severity === 'Critique')) {
        const critical = leaflet.circleMarker(project.coordinates, {
          radius: element.classList.contains('leaflet-mini-map') ? 8 : 11,
          color: '#bf5550',
          weight: 2,
          fillColor: '#bf5550',
          fillOpacity: 0.25
        });
        critical.bindTooltip(`Alerte critique · ${escapeHTML(project.id)}`);
        critical.on('click', () => {
          marker.openPopup();
          selectMapProject(project.slug, false);
        });
        criticalLayer.addLayer(critical);
      }
    });
    // Sahara occidental : limite nord en trait continu (liseré blanc dessous pour le contraste).
    // Le trait n'est affiché que sur les fonds qui comportent déjà des frontières (Plan, Relief) ;
    // il est retiré automatiquement sur le fond Satellite, qui n'en a pas.
    const saharaLayer = leaflet.layerGroup();
    const saharaBorder = leaflet.layerGroup();
    saharaBorder.addLayer(leaflet.polyline(westernSaharaNorthBorder, { color: '#ffffff', weight: isMini ? 4 : 5, opacity: 0.75, interactive: false }));
    const saharaLine = leaflet.polyline(westernSaharaNorthBorder, { color: '#1f2d3a', weight: isMini ? 2 : 2.5, opacity: 1, dashArray: null });
    saharaLine.bindTooltip('Sahara occidental · limite nord (27°40′ N) · tracé indicatif', { sticky: true });
    saharaBorder.addLayer(saharaLine);
    const syncSaharaBorder = (basemapId) => {
      if (basemaps.hasBorders(basemapId)) saharaLayer.addLayer(saharaBorder);
      else saharaLayer.removeLayer(saharaBorder);
    };
    syncSaharaBorder(basemaps.getActive());
    basemaps.subscribe(syncSaharaBorder);
    if (!isMini) {
      const saharaLabel = leaflet.circleMarker(westernSaharaLabelPoint, { radius: 1, opacity: 0, fillOpacity: 0, interactive: false });
      saharaLabel.bindTooltip('Sahara occidental', { permanent: true, direction: 'center', className: 'map-region-label' });
      saharaLayer.addLayer(saharaLabel);
    }
    wilayaLayer.addTo(map);
    Object.values(statusLayers).forEach((layer) => layer.addTo(map));
    saharaLayer.addTo(map);
    let toolbar = null;
    if (!isMini) {
      leaflet.control.scale({ imperial: false }).addTo(map);
      toolbar = buildMapToolbar(map, element, basemaps, [
        { label: 'Wilayas', title: 'Wilayas · repères indicatifs', layer: wilayaLayer, color: '#315b76' },
        { label: 'En cours', title: 'Projets · En cours', layer: statusLayers['Projets · En cours'], color: '#428b6e' },
        { label: 'En retard / surveillance', title: 'Projets · En retard / surveillance', layer: statusLayers['Projets · En retard / surveillance'], color: '#c97b21' },
        { label: 'À l’arrêt', title: 'Projets · À l’arrêt', layer: statusLayers['Projets · À l’arrêt'], color: '#bf5550' },
        { label: 'Alertes critiques', title: 'Alertes critiques', layer: criticalLayer, color: '#8f2d28' },
        { label: 'Sahara occidental', title: 'Sahara occidental · limite nord', layer: saharaLayer, color: '#1f2d3a' }
      ]);
    }
    // Vue initiale : carte nationale = toute l'Algérie, vue d'ensemble (pas de zoom sur un projet) ;
    // aucune fenêtre (popup) n'est ouverte au chargement. Le zoom + popup n'ont lieu que sur
    // une action explicite de l'utilisateur (clic sur un projet de la liste).
    const isNational = element.id === 'national-leaflet-map';
    const focusSlug = isNational ? state.mapFocusSlug : null;
    state.mapFocusSlug = null;
    const focused = focusSlug ? visibleProjects.find((project) => project.slug === focusSlug) : null;
    if (isNational) {
      if (focused) {
        map.setView(focused.coordinates, 7);
        markerBySlug.get(focused.slug)?.openPopup();
      } else {
        map.fitBounds(ALGERIA_BOUNDS, { padding: [24, 24], maxZoom: 7 });
      }
    } else if (visibleProjects.length) {
      const selected = visibleProjects.find((project) => project.slug === element.dataset.selectedProject);
      if (selected) {
        map.setView(selected.coordinates, isMini ? 5 : 7);
      } else {
        const allPoints = visibleProjects.map((project) => project.coordinates);
        map.fitBounds(leaflet.latLngBounds(allPoints), { padding: [24, 24], maxZoom: isMini ? 5 : 7 });
      }
    } else if (visibleWilayas.length) {
      map.fitBounds(leaflet.latLngBounds(visibleWilayas.map((item) => [item.lat, item.lon])), { padding: [18, 18], maxZoom: 5 });
    } else {
      map.setView([28, 2.5], 4);
    }
    const fitPoints = [
      ...visibleWilayas.map((item) => [item.lat, item.lon]),
      ...visibleProjects.map((project) => project.coordinates)
    ];
    const entry = {
      map,
      element,
      markersBySlug: markerBySlug,
      fitBounds: isNational ? leaflet.latLngBounds(ALGERIA_BOUNDS) : fitPoints.length ? leaflet.latLngBounds(fitPoints) : null,
      observer: null,
      toolbar
    };
    leafMaps.push(entry);
    // La carte peut être créée alors que son conteneur n'a pas encore sa taille finale
    // (mise en page responsive, onglet, menu latéral) : on recalcule la taille ensuite.
    let pendingRefit = !element.clientWidth || !element.clientHeight;
    const refreshSize = () => {
      map.invalidateSize({ animate: false });
      if (pendingRefit && element.clientWidth && element.clientHeight) {
        pendingRefit = false;
        if (entry.fitBounds && !(isNational && focused)) map.fitBounds(entry.fitBounds, { padding: isNational ? [24, 24] : [24, 24], maxZoom: isMini ? 5 : 7 });
      }
    };
    requestAnimationFrame(refreshSize);
    setTimeout(refreshSize, 300);
    if ('ResizeObserver' in window) {
      entry.observer = new ResizeObserver(refreshSize);
      entry.observer.observe(element);
    }
  });
}

function updateMapProjectSelection(project) {
  document.querySelectorAll('[data-reference-map-project]').forEach((button) => {
    button.classList.toggle('active', button.dataset.referenceMapProject === project.slug);
  });
  const selection = document.querySelector('[data-map-selection]');
  if (selection) {
    selection.innerHTML = `<span class="eyebrow">Projet sélectionné</span><h6 class="mt-2 mb-1">${escapeHTML(project.name)}</h6><p class="small text-muted">${escapeHTML(project.id)} · ${escapeHTML(project.wilayas.join(', '))} · ${escapeHTML(project.sector)}</p>${referenceStatusBadge(project)}
      <div class="project-fact mt-3"><span>AE actuelle</span><strong>${referenceNumber(project.aeCurrent)} Md DA</strong></div>
      <div class="project-fact"><span>Avancement physique / financier</span><strong>${referenceNumber(project.physical, 1)} % / ${referenceNumber(project.financial, 1)} %</strong></div>
      <div class="project-fact"><span>Fin contractuelle</span><strong>${escapeHTML(project.contractualEnd)}</strong></div>
      <div class="project-fact"><span>Alertes actives</span><strong>${referenceAlerts(project).length}</strong></div>
      <button class="btn btn-primary w-100 mt-3" data-reference-project="${project.slug}">Ouvrir la fiche projet</button>`;
  }
}

function selectMapProject(slug, focus = true) {
  const project = referenceProjectBySlug(slug);
  if (!project) return;
  state.selectedMapProject = slug;
  updateMapProjectSelection(project);
  if (!focus) return;
  const instance = leafMaps.find(({ element }) => element.id === 'national-leaflet-map');
  const marker = instance?.markersBySlug.get(slug);
  if (marker) {
    instance.map.setView(project.coordinates, Math.max(instance.map.getZoom(), 7));
    marker.openPopup();
  }
}

function updateMenuToggleState() {
  const expanded = String(document.documentElement.classList.contains('layout-menu-expanded'));
  document.querySelectorAll('[aria-controls="layout-menu"]').forEach((toggle) => {
    toggle.setAttribute('aria-expanded', expanded);
  });
}

function bindMenuPlugin() {
  const menu = document.querySelector('#layout-menu');
  document.querySelectorAll('.layout-menu-toggle').forEach((toggle) => {
    const control = toggle.matches('a') ? toggle : toggle.querySelector('a');
    control?.setAttribute('aria-controls', 'layout-menu');
  });
  updateMenuToggleState();
  if (menu && !menu.menuInstance && typeof window.Menu === 'function') {
    const menuInstance = new window.Menu(menu, { orientation: 'vertical', closeChildren: false });
    if (window.Helpers) window.Helpers.mainMenu = menuInstance;
  } else if (menu && !menu.menuInstance) {
    menu.querySelector('.menu-inner')?.classList.add('overflow-auto');
  }
  if (window.Helpers?.initAccordions) window.Helpers.initAccordions();
}

function renderLogin(error = '') {
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
  document.body.classList.remove('layout-menu-fixed');
  const authHeading = state.lang === 'ar' ? 'دخول مؤسسي آمن' : 'Accès à votre espace';
  const authCopy = state.lang === 'ar' ? 'استخدم حساب العرض التجريبي المخصص لدورك.' : 'Connectez-vous à votre espace institutionnel pour accéder aux projets et indicateurs autorisés.';
  app.innerHTML = `<main class="login-page"><section class="login-identity"><div class="identity-top"><div class="brand-mark"><img class="brand-mark-logo" src="assets/img/taqaddum/logo.svg" width="64" height="64" alt="Logo TAQADDUM" decoding="async"><span class="brand-mark-name"><strong>TAQADDUM</strong><span>GOUVERNANCE · PERFORMANCE · TERRITOIRES</span></span></div></div><div class="identity-copy"><span class="identity-kicker">Caisse Nationale d’Équipement pour le Développement</span><h1>Piloter les investissements publics.<br>Coordonner les acteurs.<br>Maîtriser la performance.</h1><p>Une plateforme de gouvernance et d’intelligence dédiée au suivi des projets d’infrastructure et des investissements publics.</p></div><div class="identity-footer"><span>République Algérienne Démocratique et Populaire</span><span class="arabic">الصندوق الوطني للتجهيز والتنمية</span><span class="identity-image-credit">Photo : <a href="https://commons.wikimedia.org/wiki/File:Martyrs%27_Memorial_seen_from_Le_Jardin_d%27Essai_(34985839343).jpg" target="_blank" rel="noopener noreferrer">Chris Hunkeler · CC BY-SA 2.0</a></span></div></section><section class="login-panel"><button class="btn btn-sm btn-outline-secondary login-language" data-action="language">${state.lang === 'fr' ? 'العربية' : 'Français'}</button><div class="login-panel-inner"><span class="eyebrow">Portail institutionnel</span><h2>${escapeHTML(authHeading)}</h2><p class="login-intro">${escapeHTML(authCopy)}</p>${error ? `<div class="alert alert-danger py-2" role="alert">${escapeHTML(error)}</div>` : ''}<form data-form="login" novalidate><div class="mb-3"><label class="form-label" for="login-user">${state.lang === 'ar' ? 'اسم المستخدم أو البريد المؤسسي' : 'Identifiant ou courriel institutionnel'}</label><input class="form-control" id="login-user" name="username" autocomplete="username" required placeholder="ex. pmo" /></div><div class="mb-3"><label class="form-label" for="login-password">${state.lang === 'ar' ? 'كلمة المرور' : 'Mot de passe'}</label><div class="input-group input-group-merge"><input class="form-control" id="login-password" name="password" type="password" autocomplete="current-password" required placeholder="••••••••"><button class="btn btn-outline-secondary" type="button" data-action="toggle-password" aria-label="Afficher le mot de passe"><i class="bx bx-hide"></i></button></div></div><div class="d-flex align-items-center justify-content-between mb-4"><div class="form-check"><input class="form-check-input" type="checkbox" id="remember" name="remember"><label class="form-check-label small" for="remember">Se souvenir de moi</label></div><button class="btn btn-link p-0 small" type="button" data-action="forgot-password">Mot de passe oublié ?</button></div><button class="btn btn-primary w-100 py-2" type="submit"><span data-login-label>Se connecter</span><span class="spinner-border spinner-border-sm ms-2 d-none" data-login-spinner></span></button></form><details class="login-demo"><summary>Accès de démonstration — comptes locaux</summary><p class="small text-muted mt-2 mb-2">Prototype frontend uniquement. Ces identifiants fictifs ne constituent pas un mécanisme d’authentification sécurisé.</p><div class="demo-account-list">${demoAccounts.map((account) => `<button class="demo-account" type="button" data-demo-user="${escapeHTML(account.username)}"><strong>${escapeHTML(account.role)}</strong><span>${escapeHTML(account.username)} · ${escapeHTML(account.password)}</span></button>`).join('')}</div></details><div class="d-flex justify-content-between mt-4 small text-muted"><span>© TAQADDUM · Démonstrateur</span><span>FR / AR</span></div></div></section></main>`;
}

function appToast(message) {
  const stack = document.querySelector('#toast-stack');
  const toast = document.createElement('div');
  toast.className = 'app-toast';
  toast.textContent = message;
  stack.append(toast);
  window.setTimeout(() => toast.remove(), 3500);
}

function showModal(html, size = '') {
  const modal = document.querySelector('#detail-modal');
  if (!modal) return;
  const dialog = modal.querySelector('.modal-dialog');
  dialog.className = `modal-dialog modal-dialog-centered ${size}`.trim();
  modal.querySelector('.modal-content').innerHTML = html;
  if (window.bootstrap?.Modal) window.bootstrap.Modal.getOrCreateInstance(modal).show();
  else modal.classList.add('show');
}

function closeModal() {
  const modal = document.querySelector('#detail-modal');
  if (modal && window.bootstrap?.Modal) window.bootstrap.Modal.getOrCreateInstance(modal).hide();
}

function openKpiDetail(id) {
  const item = kpiById(id);
  if (!item || !rolePermission('kpis', id)) {
    appToast('Cet indicateur n’est pas visible selon la matrice de rôles.');
    return;
  }
  const value = valueFor(item, state.projectId ? projectById(state.projectId) : null);
  const detailProject = state.projectId ? projectById(state.projectId) : null;
  const status = statusFor(item, value, detailProject);
  const related = allScopedProjects().filter((project) => project.values[item.KPI_ID] !== undefined).slice(0, 5);
  const relatedAlerts = currentInstances().filter((instance) => ruleKpiIds(alertRule(instance.ruleId)).includes(item.KPI_ID));
  showModal(`<div class="modal-header"><div><span class="kpi-id">${escapeHTML(item.KPI_ID)}</span><h5 class="modal-title mt-2">${escapeHTML(item.Nom_KPI)}</h5><small class="text-muted">${escapeHTML(item.Famille)} · ${escapeHTML(item.Phase)} · ${escapeHTML(item.Importance)}</small></div><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fermer"></button></div><div class="modal-body"><div class="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-4"><div><span class="small text-muted">Valeur illustrative</span><strong class="d-block fs-3">${escapeHTML(formatValue(item, value))}</strong></div>${statusPill(status)}<span class="badge bg-label-secondary">${escapeHTML(item.Sens || 'Information')}</span></div><div class="row g-4"><div class="col-md-7"><div class="threshold-line"><span class="threshold-label">Définition</span><span>${escapeHTML(item.Définition || '')}</span></div><div class="threshold-line"><span class="threshold-label">Formule</span><span>${escapeHTML(item.Formule || '—')}</span></div><div class="threshold-line"><span class="threshold-label">Source</span><span>${escapeHTML(item.Alimenté_par || '')} · ${escapeHTML(item.Tables_sources || '')}</span></div><div class="threshold-line"><span class="threshold-label">Responsable</span><span>${escapeHTML(item.Responsable || '—')} · droit ${escapeHTML(rolePermission('kpis', id))}</span></div><div class="threshold-line"><span class="threshold-label">Fréquence</span><span>${escapeHTML(item.Fréquence_cible || '—')} · ${escapeHTML(item.Calculabilité || '')}</span></div></div><div class="col-md-5"><div class="card bg-lighter shadow-none"><div class="card-body"><strong class="small">Seuils de lecture</strong><div class="threshold-line mt-2"><span class="threshold-label text-success">VERT</span><span>${escapeHTML(item.Vert || '—')}</span></div><div class="threshold-line"><span class="threshold-label text-warning">ORANGE</span><span>${escapeHTML(item.Orange || '—')}</span></div><div class="threshold-line"><span class="threshold-label text-danger">ROUGE</span><span>${escapeHTML(item.Rouge || '—')}</span></div><p class="small text-muted mt-3 mb-0">Interprétation conforme au sens de cet indicateur. Les seuils de référence sont ceux du classeur TAQADDUM.</p></div></div></div></div><div class="mt-4"><strong class="small">Tendance illustrative</strong>${lineChart(`${item.KPI_ID} · ${item.Unité || ''}`, [48, 53, 51, 55, 57, Number.isFinite(numeric(value)) ? numeric(value) : 58])}</div><div class="row g-4 mt-1"><div class="col-md-6"><strong class="small">Projets visibles associés</strong><div class="mt-2">${related.map((project) => `<div class="d-flex justify-content-between border-bottom py-2 small"><span>${escapeHTML(project.shortName)}</span><span>${escapeHTML(formatValue(item, valueFor(item, project)))}</span></div>`).join('') || '<p class="small text-muted">Aucun projet.</p>'}</div></div><div class="col-md-6"><strong class="small">Alertes visibles liées</strong><div class="mt-2">${relatedAlerts.map((instance) => `<button class="btn btn-link p-0 d-block small" data-alert-id="${escapeHTML(instance.id)}">${escapeHTML(instance.ruleId)} · ${escapeHTML(alertRule(instance.ruleId)?.Nom || '')}</button>`).join('') || '<span class="small text-muted">Aucune instance visible.</span>'}</div></div></div></div><div class="modal-footer"><span class="small text-muted me-auto">Dernière mise à jour illustrative · ${shortDate('2026-11-10')}</span><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Fermer</button></div>`);
}

function openAlertDetail(id) {
  const instance = currentInstances().find((item) => item.id === id);
  if (!instance) {
    appToast('Cette alerte n’est pas accessible dans votre périmètre.');
    return;
  }
  const rule = alertRule(instance.ruleId);
  const project = projectById(instance.projectId);
  const permission = rolePermission('alerts', instance.ruleId);
  const current = { ...instance, ...state.alertChanges[id] };
  const canAct = permission === 'D';
  const history = current.comments || [];
  const statuses = ['Nouvelle', 'À traiter', 'En cours', 'En attente', 'Escaladée', 'Résolue', 'Clôturée'];
  const underlyingKpis = ruleKpiIds(rule);
  const triggerDetails = ruleThresholds(rule).map((trigger) => `<div class="threshold-line"><span class="threshold-label">${escapeHTML(trigger.field)}</span><span>${escapeHTML(`${trigger.operator || ''} ${trigger.threshold || ''}`.trim())}</span></div>`).join('');
  const kpiLinks = underlyingKpis.map((kpiId) => rolePermission('kpis', kpiId)
    ? `<button type="button" class="btn btn-sm btn-outline-secondary me-1 mb-1" data-kpi-id="${escapeHTML(kpiId)}">${escapeHTML(kpiId)} · détail</button>`
    : `<span class="kpi-id me-1">${escapeHTML(kpiId)}</span>`).join('') || '<span class="text-muted">Champ opérationnel · aucun KPI direct</span>';
  showModal(`
    <div class="modal-header">
      <div>
        <span class="kpi-id">${escapeHTML(instance.ruleId)}</span>
        <h5 class="modal-title mt-2">${escapeHTML(rule?.Nom || '')}</h5>
        <small class="text-muted">${escapeHTML(project?.name || '')} · ${escapeHTML(project?.id || '')}</small>
      </div>
      <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fermer"></button>
    </div>
    <form data-form="alert-update" data-alert-id="${escapeHTML(id)}">
      <div class="modal-body alert-modal-content">
        <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
          ${statusPill(rule?.Niveau === 'ROUGE' ? 'red' : 'orange', rule?.Niveau || '')}
          ${importanceBadge(rule?.Importance)}
          <span class="badge bg-label-secondary">Droit : ${permission === 'D' ? 'Destinataire · action' : 'Informé · lecture seule'}</span>
        </div>
        <div class="threshold-line"><span class="threshold-label">Condition</span><span>${escapeHTML(alertCondition(rule))}</span></div>
        <div class="threshold-line"><span class="threshold-label">Logique</span><span>${escapeHTML(rule?.Logique || '—')}</span></div>
        <div class="threshold-line"><span class="threshold-label">Valeurs déclenchantes</span><span>${escapeHTML(instance.values)}</span></div>
        <div class="threshold-line"><span class="threshold-label">Conditions détaillées</span><div>${triggerDetails || '—'}</div></div>
        <div class="threshold-line"><span class="threshold-label">KPI sous-jacents</span><span>${kpiLinks}</span></div>
        <div class="row g-3 mt-2">
          <div class="col-md-6"><strong>Action attendue</strong><p>${escapeHTML(rule?.Action || '')}</p></div>
          <div class="col-md-6"><strong>Détectée le</strong><p>${shortDate(instance.detected)} · ${escapeHTML(rule?.Fréquence || '')}</p></div>
          <div class="col-md-6"><strong>Fiabilité des données</strong><p>${statusPill(instance.confidence === 'Fiable' ? 'green' : instance.confidence === 'Insuffisante' ? 'red' : 'orange', instance.confidence)}<br><span class="small">Vérifier DO1, DO2 et DO3 avant toute conclusion opérationnelle.</span></p></div>
          <div class="col-md-6"><strong>Destinataires</strong><p>${escapeHTML(rule?.Destinataire || '')} · Mon droit : ${permission}</p></div>
        </div>
        <div class="access-note mb-3">Alerte de démonstration. Un signal ne déclenche jamais automatiquement une mise en demeure, une sanction, une résiliation ou une décision administrative.</div>
        ${canAct ? `
          <div class="row g-3">
            <div class="col-md-6"><label class="form-label">État de traitement</label><select class="form-select" name="status">${statuses.map((status) => `<option ${current.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></div>
            <div class="col-md-6"><label class="form-label">Responsable</label><input class="form-control" name="assignee" value="${escapeHTML(current.assignee || '')}" required></div>
            <div class="col-md-6"><label class="form-label">Échéance cible</label><input class="form-control" name="due" type="date" value="${escapeHTML(current.due || '')}"></div>
            <div class="col-12"><label class="form-label">Action corrective / commentaire</label><textarea class="form-control" name="comment" rows="2" placeholder="Consigner une action ou un commentaire…" required></textarea></div>
          </div>` : `
          <div class="project-fact"><span>Responsable</span><strong>${escapeHTML(current.assignee || '')}</strong></div>
          <div class="project-fact"><span>Échéance</span><strong>${current.due ? shortDate(current.due) : 'Non définie'}</strong></div>`}
        <div class="mt-3"><strong>Historique de suivi</strong><p class="small text-muted mt-1">${escapeHTML(instance.note)}</p>${history.map((comment) => `<div class="border-top py-2"><span class="small fw-semibold">${escapeHTML(comment.author)}</span><span class="small text-muted ms-2">${escapeHTML(comment.date)}</span><p class="small mb-0">${escapeHTML(comment.text)}</p></div>`).join('')}</div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline-secondary" type="button" data-bs-dismiss="modal">Fermer</button>
        ${canAct ? '<button class="btn btn-primary" type="submit">Enregistrer le suivi</button>' : ''}
      </div>
    </form>`);
}

function renderFatal(error) {
  console.error(error);
  app.innerHTML = `<main class="container py-5"><div class="card"><div class="card-body"><h4>Chargement impossible</h4><p class="text-muted">Le référentiel local n’a pas pu être chargé. Ouvrez l’application avec un serveur web local, puis rechargez la page.</p><pre class="small text-danger">${escapeHTML(error.message)}</pre></div></div></main>`;
}

function openProject(id) {
  if (!scopedProjectIds().has(id)) {
    appToast('Ce projet ne relève pas de votre périmètre.');
    return;
  }
  state.projectId = id;
  state.projectTab = 'overview';
  state.page = 'project';
  render();
}

function openReferenceProject(slug) {
  const project = referenceProjectBySlug(slug);
  if (!project || !['direction', 'pmo'].includes(roleKeyFor(state.user))) {
    appToast('Cette fiche de référence n’est pas accessible dans votre périmètre.');
    return;
  }
  state.referenceProjectId = project.slug;
  state.referenceProjectTab = 'synthese';
  state.page = project.slug === 'djendjen' ? 'reference-project' : 'reference-details';
  state.projectId = null;
  render();
}

app.addEventListener('click', (event) => {
  const target = event.target.closest('[data-nav], [data-project-id], [data-reference-project], [data-reference-map-project], [data-reference-project-tab], [data-reference-portfolio-status], [data-prepare-reference-action], [data-dashboard-status], [data-search-all], [data-kpi-id], [data-alert-id], [data-rule-id], [data-project-tab], [data-alert-tab], [data-action], [data-demo-user], [data-page], [data-export], [data-map-project], [data-map-toggle], [data-map-fit], [data-map-reset], [data-conversation-id], [data-doc-preview], [data-notification-id]');
  if (!target) return;
  if (target.dataset.dashboardStatus !== undefined) {
    state.referencePortfolioStatus = target.dataset.dashboardStatus;
    state.referencePortfolioQuery = '';
    state.page = 'portfolio';
    state.projectId = null;
    state.globalSearch = '';
    render();
    return;
  }
  if (target.dataset.searchAll !== undefined) {
    const query = target.dataset.searchAll;
    state.projectId = null;
    state.page = 'portfolio';
    if (['direction', 'pmo'].includes(roleKeyFor(state.user))) {
      state.referencePortfolioQuery = query;
      state.referencePortfolioStatus = '';
      state.globalSearch = '';
    } else {
      state.globalSearch = query;
    }
    render();
    return;
  }
  if (target.dataset.demoUser) {
    const account = demoAccounts.find((item) => item.username === target.dataset.demoUser);
    document.querySelector('[name="username"]').value = account.username;
    document.querySelector('[name="password"]').value = account.password;
    return;
  }
  if (target.dataset.action === 'language') {
    state.lang = state.lang === 'fr' ? 'ar' : 'fr';
    localStorage.setItem('cned-language', JSON.stringify(state.lang));
    render();
    return;
  }
  if (target.dataset.action === 'toggle-password') {
    const input = document.querySelector('#login-password');
    input.type = input.type === 'password' ? 'text' : 'password';
    return;
  }
  if (target.dataset.action === 'forgot-password') {
    appToast('Compte de démonstration : aucun service de réinitialisation réel n’est connecté.');
    return;
  }
  if (target.dataset.action === 'mention') {
    const conversation = conversations.find((item) => item.id === state.selectedConversation);
    const participant = conversation?.participants.find((name) => name !== state.user.name);
    const input = document.querySelector('[data-form="message-send"] [name="message"]');
    if (participant && input) {
      input.value = `${input.value}${input.value ? ' ' : ''}@${participant} `;
      input.focus();
    }
    return;
  }
  if (target.dataset.action === 'show-upload') {
    showUploadModal();
    return;
  }
  if (target.dataset.action === 'mark-read') {
    state.notificationsRead = [...new Set([...state.notificationsRead, ...currentInstances().map((item) => item.id)])];
    localStorage.setItem('cned-notifications-read', JSON.stringify(state.notificationsRead));
    renderCurrentPage();
    appToast('Notifications visibles marquées comme lues.');
    return;
  }
  if (target.dataset.action === 'logout') {
    localStorage.removeItem('cned-demo-user');
    sessionStorage.removeItem('cned-demo-session');
    state.user = null;
    state.page = 'dashboard';
    render();
    return;
  }
  if (target.dataset.nav) {
    const requested = target.dataset.nav;
    if (!role().nav.includes(requested)) {
      appToast('Cette section n’est pas autorisée pour votre rôle.');
      return;
    }
    state.page = requested;
    if (requested === 'reference-project') {
      state.referenceProjectId = 'djendjen';
      state.referenceProjectTab = 'synthese';
    }
    state.projectId = null;
    state.globalSearch = '';
    render();
    return;
  }
  if (target.dataset.referenceProject) {
    openReferenceProject(target.dataset.referenceProject);
    return;
  }
  if (target.hasAttribute('data-reference-portfolio-status')) {
    state.referencePortfolioStatus = target.dataset.referencePortfolioStatus;
    renderCurrentPage();
    return;
  }
  if (target.hasAttribute('data-prepare-reference-action')) {
    const action = referenceActions[Number(target.dataset.prepareReferenceAction)];
    const form = document.querySelector('[data-form="reference-message"]');
    if (!action || !form) {
      appToast('Impossible de préparer cette action de référence.');
      return;
    }
    form.elements.projectSlug.value = action.projectSlug;
    form.elements.recipient.value = referenceActionRecipient(action);
    form.elements.subject.value = action.action;
    form.elements.message.value = `Pour mise en œuvre : ${action.action}. Merci de nous communiquer l’état d’avancement et la date prévue de levée.`;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    form.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
    form.elements.subject.focus();
    return;
  }
  if (target.dataset.referenceProjectTab) {
    state.referenceProjectTab = target.dataset.referenceProjectTab;
    renderCurrentPage();
    return;
  }
  if (target.dataset.projectId) {
    openProject(target.dataset.projectId);
    return;
  }
  if (target.dataset.kpiId) {
    openKpiDetail(target.dataset.kpiId);
    return;
  }
  if (target.dataset.alertId) {
    openAlertDetail(target.dataset.alertId);
    return;
  }
  if (target.dataset.ruleId) {
    const rule = alertRule(target.dataset.ruleId);
    if (!rule || !rolePermission('alerts', rule.Regle_ID)) {
      appToast('Cette règle n’est pas visible selon la matrice de rôles.');
      return;
    }
    showModal(`<div class="modal-header"><div><span class="kpi-id">${escapeHTML(rule.Regle_ID)}</span><h5 class="modal-title mt-2">${escapeHTML(rule.Nom)}</h5></div><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body alert-modal-content"><div class="d-flex gap-2 mb-3">${statusPill(rule.Niveau === 'ROUGE' ? 'red' : 'orange', rule.Niveau)}${importanceBadge(rule.Importance)}<span class="badge bg-label-info">${escapeHTML(rule.Phase)}</span></div><div class="threshold-line"><span class="threshold-label">Condition</span><span>${escapeHTML(alertCondition(rule))}</span></div><div class="threshold-line"><span class="threshold-label">Logique</span><span>${escapeHTML(rule.Logique || '')}</span></div><div class="threshold-line"><span class="threshold-label">Déclencheurs</span><span>${[rule.C1_KPI_ou_champ, rule.C2_KPI_ou_champ, rule.C3_KPI_ou_champ].filter(Boolean).map(escapeHTML).join(' · ') || '—'}</span></div><div class="threshold-line"><span class="threshold-label">Destinataire</span><span>${escapeHTML(rule.Destinataire || '')} · Mon droit ${rolePermission('alerts', rule.Regle_ID)}</span></div><div class="threshold-line"><span class="threshold-label">Action / fréquence</span><span>${escapeHTML(rule.Action || '')} · ${escapeHTML(rule['Fréquence'] || '')}</span></div></div><div class="modal-footer"><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Fermer</button></div>`);
    return;
  }
  if (target.dataset.projectTab) {
    state.projectTab = target.dataset.projectTab;
    renderCurrentPage();
    return;
  }
  if (target.dataset.alertTab) {
    state.alertTab = target.dataset.alertTab;
    renderCurrentPage();
    return;
  }
  if (target.dataset.page) {
    state.tablePages[target.dataset.page] = Math.max(1, (state.tablePages[target.dataset.page] || 1) + Number(target.dataset.delta));
    renderCurrentPage();
    return;
  }
  if (target.dataset.export) {
    exportData(target.dataset.export);
    return;
  }
  if (target.dataset.mapProject) {
    state.selectedMapProject = target.dataset.mapProject;
    if (state.mapView === 'map') state.mapFocusSlug = target.dataset.mapProject;
    renderCurrentPage();
    return;
  }
  if (target.dataset.referenceMapProject) {
    selectMapProject(target.dataset.referenceMapProject);
    return;
  }
  if (target.hasAttribute('data-map-fit')) {
    const instance = leafMaps.find(({ element }) => element.id === 'national-leaflet-map');
    if (instance?.fitBounds) {
      instance.map.fitBounds(instance.fitBounds, { padding: [24, 24], maxZoom: 7 });
    }
    return;
  }
  if (target.hasAttribute('data-map-reset')) {
    state.mapFilters = {};
    state.selectedMapProject = null;
    localStorage.setItem('cned-map-filters', JSON.stringify(state.mapFilters));
    renderCurrentPage();
    return;
  }
  if (target.hasAttribute('data-map-toggle')) {
    state.mapView = state.mapView === 'map' ? 'list' : 'map';
    state.mapFocusSlug = null;
    renderCurrentPage();
    return;
  }
  if (target.dataset.conversationId) {
    const conversation = conversations.find((item) => item.id === target.dataset.conversationId);
    if (conversation && scopedProjectIds().has(conversation.projectId)) {
      state.selectedConversation = conversation.id;
      renderCurrentPage();
    }
    return;
  }
  if (target.dataset.docPreview) {
    const document = visibleDocuments().find((item) => item.name === target.dataset.docPreview);
    if (!document) {
      appToast('Ce document n’est pas accessible dans votre périmètre.');
      return;
    }
    showModal(`<div class="modal-header"><h5 class="modal-title">Aperçu du document</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><div class="text-center py-4"><span class="document-type mx-auto">${escapeHTML(document.type)}</span><h6 class="mt-3">${escapeHTML(document.name)}</h6><p class="text-muted small">${escapeHTML(projectById(document.projectId)?.shortName || '')} · ${escapeHTML(document.category)} · ${shortDate(document.date)}</p><div class="alert alert-secondary text-start small mb-0">Aperçu simulé. Le prototype ne stocke ni ne transmet le contenu du fichier.</div></div></div><div class="modal-footer"><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Fermer</button><button class="btn btn-primary" data-download-document="${escapeHTML(document.name)}">Télécharger l’exemple</button></div>`);
    return;
  }
  if (target.dataset.notificationId) {
    if (!state.notificationsRead.includes(target.dataset.notificationId)) {
      state.notificationsRead.push(target.dataset.notificationId);
      localStorage.setItem('cned-notifications-read', JSON.stringify(state.notificationsRead));
    }
  }
});

app.addEventListener('click', (event) => {
  if (event.target.closest('[data-search-results] .search-item, [data-search-all]')) {
    const input = document.querySelector('.navbar-search [name="query"]');
    if (input) input.value = '';
    closeSearchResults();
  } else if (!event.target.closest('.navbar-search')) {
    closeSearchResults();
  }
  const menuToggle = event.target.closest('.layout-menu-toggle');
  if (menuToggle) {
    event.preventDefault();
    window.Helpers?.toggleCollapsed?.();
    updateMenuToggleState();
    window.setTimeout(updateMenuToggleState, 20);
    return;
  }
  if (
    event.target.closest('[data-nav], [data-action="logout"]') &&
    window.Helpers?.isSmallScreen?.() &&
    document.documentElement.classList.contains('layout-menu-expanded')
  ) {
    window.Helpers.toggleCollapsed();
    updateMenuToggleState();
    window.setTimeout(updateMenuToggleState, 20);
  }
});

app.addEventListener('focusin', (event) => {
  if (event.target.matches('.navbar-search [name="query"]') && event.target.value.trim()) updateSearchResults(event.target.closest('form'));
});

app.addEventListener('keydown', (event) => {
  if (event.target.matches('.navbar-search [name="query"]')) {
    const form = event.target.closest('form');
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (form.querySelector('[data-search-results]').hidden) updateSearchResults(form);
      moveSearchSelection(form, event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Escape') {
      closeSearchResults();
    }
    return;
  }
  if (!['Enter', ' '].includes(event.key)) return;
  const row = event.target.closest('.reference-row-link');
  if (!row) return;
  event.preventDefault();
  openReferenceProject(row.dataset.referenceProject);
});

app.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  if (form.dataset.form === 'login') {
    const username = String(data.get('username') || '').trim();
    const password = String(data.get('password') || '');
    const account = demoAccounts.find((item) => item.username === username && item.password === password);
    if (!account) {
      renderLogin('Identifiant ou mot de passe invalide. Utilisez un compte local de démonstration.');
      return;
    }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    form.querySelector('[data-login-label]').textContent = 'Ouverture de votre espace…';
    form.querySelector('[data-login-spinner]').classList.remove('d-none');
    await new Promise((resolve) => window.setTimeout(resolve, 320));
    state.user = account;
    let storageUnavailable = false;
    try {
      if (data.get('remember')) {
        localStorage.setItem('cned-demo-user', JSON.stringify(account));
        sessionStorage.removeItem('cned-demo-session');
      } else {
        sessionStorage.setItem('cned-demo-session', JSON.stringify(account));
        localStorage.removeItem('cned-demo-user');
      }
    } catch (error) {
      console.warn('Demo session could not be persisted; keeping it in memory.', error);
      storageUnavailable = true;
    }
    state.page = 'dashboard';
    render();
    if (storageUnavailable) appToast('Session ouverte en mémoire uniquement ; le stockage du navigateur est indisponible.');
    return;
  }
  if (form.dataset.form === 'global-search') {
    const query = String(data.get('query') || '').trim();
    if (!query) return;
    updateSearchResults(form);
    const choice = form.querySelector('.search-item.active') || form.querySelector('.search-item');
    if (choice) choice.click();
    return;
  }
  if (form.dataset.form === 'project-search') {
    state.globalSearch = String(data.get('query') || '').trim();
    state.projectStatus = String(data.get('status') || '');
    state.projectSort = String(data.get('sort') || 'name');
    localStorage.setItem('cned-project-status', JSON.stringify(state.projectStatus));
    localStorage.setItem('cned-project-sort', JSON.stringify(state.projectSort));
    state.tablePages.portfolio = 1;
    renderCurrentPage();
    return;
  }
  if (form.dataset.form === 'reference-portfolio-search') {
    state.referencePortfolioQuery = String(data.get('query') || '').trim();
    renderCurrentPage();
    return;
  }
  if (form.dataset.form === 'reference-message') {
    if (!['direction', 'pmo'].includes(roleKeyFor(state.user))) {
      appToast('La saisie de suivi est réservée à la direction et au PMO.');
      return;
    }
    const subjectField = form.elements.subject;
    const subject = String(data.get('subject') || '').trim();
    if (!subject) {
      subjectField.classList.add('is-invalid');
      subjectField.setAttribute('aria-invalid', 'true');
      subjectField.focus();
      appToast('Renseignez l’objet du message avant de l’enregistrer.');
      return;
    }
    subjectField.classList.remove('is-invalid');
    subjectField.removeAttribute('aria-invalid');
    const projectSlug = String(data.get('projectSlug') || '');
    const project = referenceProjectBySlug(projectSlug);
    if (!project) {
      appToast('Sélectionnez un projet de référence valide.');
      return;
    }
    state.referenceMessageJournal.unshift({
      date: new Date().toLocaleDateString('fr-FR'),
      projectSlug,
      recipient: String(data.get('recipient') || ''),
      type: String(data.get('type') || ''),
      subject,
      message: String(data.get('message') || '').trim(),
      status: 'Enregistré'
    });
    const persisted = persistReferenceMessageJournal(state.referenceMessageJournal);
    form.reset();
    renderCurrentPage();
    appToast(persisted
      ? 'Échange enregistré dans le journal local.'
      : 'Échange ajouté au journal de cette session ; le stockage du navigateur est indisponible.');
    return;
  }
  if (form.dataset.form === 'map-filters') {
    state.mapFilters = {
      wilaya: String(data.get('wilaya') || ''),
      region: String(data.get('region') || ''),
      sector: String(data.get('sector') || ''),
      status: String(data.get('status') || ''),
      budget: String(data.get('budget') || ''),
      alertSeverity: String(data.get('alertSeverity') || ''),
      query: String(data.get('query') || '').trim()
    };
    localStorage.setItem('cned-map-filters', JSON.stringify(state.mapFilters));
    state.selectedMapProject = null;
    renderCurrentPage();
    return;
  }
  if (form.dataset.form === 'reference-field-update') {
    const project = referenceProjectBySlug(state.referenceProjectId);
    const field = String(data.get('field') || '');
    const value = String(data.get('value') || '').trim();
    if (roleKeyFor(state.user) !== 'pmo' || project?.slug !== 'djendjen') {
      appToast('La saisie de référence est réservée au PMO sur la fiche Djendjen.');
      return;
    }
    if (!djendjenOperationalFields.some((item) => item.name === field) || !value) {
      appToast('Sélectionnez un champ autorisé et renseignez une valeur.');
      return;
    }
    state.referenceOperationalUpdates[`${project.slug}:${field}`] = {
      value,
      author: state.user.name,
      date: new Date().toLocaleDateString('fr-FR'),
      status: 'À valider'
    };
    localStorage.setItem('cned-reference-field-updates', JSON.stringify(state.referenceOperationalUpdates));
    renderCurrentPage();
    appToast('Saisie locale enregistrée · validation institutionnelle requise.');
    return;
  }
  if (form.dataset.form === 'document-filter') {
    state.documentFilters = { query: String(data.get('document-query') || '').trim(), category: String(data.get('document-category') || '') };
    renderCurrentPage();
    return;
  }
  if (form.dataset.form === 'alert-update') {
    const id = form.dataset.alertId;
    if (!currentInstances().some((item) => item.id === id) || rolePermission('alerts', alertInstances.find((item) => item.id === id)?.ruleId) !== 'D') {
      appToast('Seul un destinataire autorisé peut mettre à jour le suivi de cette alerte.');
      closeModal();
      return;
    }
    const comment = String(data.get('comment') || '').trim();
    if (!comment) {
      form.querySelector('[name="comment"]').classList.add('is-invalid');
      appToast('Ajoutez un commentaire ou une action corrective avant l’enregistrement.');
      return;
    }
    const previous = state.alertChanges[id] || {};
    state.alertChanges[id] = {
      ...previous,
      status: String(data.get('status')),
      assignee: String(data.get('assignee')).trim(),
      due: String(data.get('due') || ''),
      comments: [...(previous.comments || []), { author: state.user.name, text: comment, date: shortDate('2026-11-13') }]
    };
    localStorage.setItem('cned-alert-changes', JSON.stringify(state.alertChanges));
    closeModal();
    render();
    appToast('Le suivi local de l’alerte a été enregistré.');
    return;
  }
  if (form.dataset.form === 'message-send') {
    const conversation = conversations.find((item) => item.id === state.selectedConversation);
    const text = String(data.get('message') || '').trim();
    if (!conversation || !text) return;
    const currentMessages = state.messages[conversation.id] || conversation.messages;
    state.messages[conversation.id] = [...currentMessages, { author: state.user.name, initials: state.user.initials, text, attachment: state.pendingMessageAttachment, time: 'À l’instant' }];
    localStorage.setItem('cned-messages', JSON.stringify(state.messages));
    state.pendingMessageAttachment = '';
    if (state.chatAttachmentPreviewUrl) URL.revokeObjectURL(state.chatAttachmentPreviewUrl);
    state.chatAttachmentPreviewUrl = '';
    renderCurrentPage();
    return;
  }
  if (form.dataset.form === 'field-report') {
    const projectId = String(data.get('projectId') || '');
    const project = projectById(projectId);
    if (!project || !scopedProjectIds().has(project.id)) {
      appToast('Sélectionnez un projet de votre périmètre.');
      return;
    }
    const report = { id: `FIELD-${Date.now()}`, projectId, author: state.user.name, date: '2026-11-13', type: String(data.get('type') || 'Visite de chantier'), progress: String(data.get('progress') || ''), note: String(data.get('note') || '').trim(), status: 'En attente de synchronisation', fileName: form.querySelector('[name="photo"]')?.files?.[0]?.name || '' };
    if (!report.note) {
      form.querySelector('[name="note"]').classList.add('is-invalid');
      appToast('Ajoutez une observation avant de transmettre le rapport.');
      return;
    }
    state.fieldReports.unshift(report);
    localStorage.setItem('cned-field-reports', JSON.stringify(state.fieldReports));
    renderCurrentPage();
    appToast('Rapport enregistré localement · synchronisation en attente.');
    return;
  }
  if (form.dataset.form === 'document-upload') {
    const file = form.querySelector('[name="file"]')?.files?.[0];
    const projectId = String(data.get('projectId') || '');
    if (!file || !scopedProjectIds().has(projectId)) {
      appToast('Choisissez un fichier et un projet autorisé.');
      return;
    }
    const item = { name: file.name, projectId, category: String(data.get('category') || 'Terrain'), type: file.name.split('.').pop().toUpperCase(), owner: state.user.name, date: '2026-11-13', version: 'v1.0', access: 'Projet', localOnly: true };
    state.localDocuments.unshift(item);
    localStorage.setItem('cned-local-documents', JSON.stringify(state.localDocuments));
    renderCurrentPage();
    appToast('Document ajouté au dossier de démonstration (métadonnées locales uniquement).');
  }
});

app.addEventListener('change', (event) => {
  const filterNames = {
    'kpi-family': 'family',
    'kpi-importance': 'importance',
    'kpi-phase': 'phase',
    'kpi-responsible': 'responsible',
    'kpi-status': 'status',
    'kpi-project': 'project',
    'kpi-reporting-date': 'reportingDate'
  };
  if (filterNames[event.target.name]) {
    state.kpiFilters[filterNames[event.target.name]] = event.target.value;
    localStorage.setItem('cned-kpi-filters', JSON.stringify(state.kpiFilters));
    renderCurrentPage();
  }
  if (event.target.matches('[name="alert-status"], [name="alert-severity"], [name="alert-query"]')) {
    state.alertFilters = {
      status: document.querySelector('[name="alert-status"]')?.value || '',
      severity: document.querySelector('[name="alert-severity"]')?.value || '',
      query: document.querySelector('[name="alert-query"]')?.value || ''
    };
    localStorage.setItem('cned-alert-filters', JSON.stringify(state.alertFilters));
    renderCurrentPage();
  }
  if (event.target.matches('[data-report-period]')) {
    state.reportPeriod = event.target.value;
    localStorage.setItem('cned-report-period', JSON.stringify(state.reportPeriod));
    renderCurrentPage();
  }
  if (event.target.matches('[name="document-category"], [name="document-query"]')) {
    state.documentFilters = {
      category: document.querySelector('[name="document-category"]')?.value || '',
      query: document.querySelector('[name="document-query"]')?.value || ''
    };
    localStorage.setItem('cned-document-filters', JSON.stringify(state.documentFilters));
    renderCurrentPage();
  }
  if (event.target.matches('[data-planning-range]')) {
    state.planningRange = event.target.value;
    appToast(`Période de planning : ${state.planningRange} · vue illustrative.`);
  }
  if (event.target.matches('[name="photo"]')) {
    const file = event.target.files?.[0];
    if (!file) return;
    const preview = document.querySelector('[data-photo-preview]');
    if (preview && file.type.startsWith('image/')) {
      if (state.photoPreviewUrl) URL.revokeObjectURL(state.photoPreviewUrl);
      state.photoPreviewUrl = URL.createObjectURL(file);
      preview.innerHTML = `<img src="${state.photoPreviewUrl}" alt="Aperçu de la photo sélectionnée">`;
    } else if (preview) preview.textContent = file.name;
  }
  if (event.target.matches('[data-message-attachment]')) {
    const file = event.target.files?.[0];
    if (!file) return;
    state.pendingMessageAttachment = file.name;
    document.querySelector('[data-chat-attachment-label]').textContent = file.name;
    const preview = document.querySelector('[data-chat-attachment-preview]');
    if (state.chatAttachmentPreviewUrl) URL.revokeObjectURL(state.chatAttachmentPreviewUrl);
    state.chatAttachmentPreviewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : '';
    if (preview) preview.innerHTML = state.chatAttachmentPreviewUrl
      ? `<span class="photo-preview"><img src="${state.chatAttachmentPreviewUrl}" alt="Aperçu de la pièce jointe"></span>`
      : `<span class="small text-muted">${escapeHTML(file.name)} · aperçu simulé</span>`;
  }
}
);

app.addEventListener('input', (event) => {
  if (event.target.matches('.navbar-search [name="query"]')) updateSearchResults(event.target.closest('form'));
  if (event.target.matches('[data-kpi-search]')) {
    state.globalSearch = event.target.value;
    renderCurrentPage();
    const input = document.querySelector('[data-kpi-search]');
    input?.focus();
    input?.setSelectionRange(state.globalSearch.length, state.globalSearch.length);
  }
  if (event.target.matches('[data-conversation-search]')) {
    const query = event.target.value.toLowerCase();
    document.querySelectorAll('.conversation-item').forEach((item) => {
      item.hidden = !item.textContent.toLowerCase().includes(query);
    });
  }
});

document.addEventListener('click', (event) => {
  const download = event.target.closest('[data-download-document]');
  if (!download) return;
  const name = download.dataset.downloadDocument;
  const documentRecord = visibleDocuments().find((item) => item.name === name);
  if (!documentRecord) {
    appToast('Ce document n’est pas accessible dans votre périmètre.');
    return;
  }
  const content = `TAQADDUM — Exemple de téléchargement\n${documentRecord.name}\n${projectById(documentRecord.projectId)?.shortName || ''}\nDonnées de démonstration uniquement.`;
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${name}.exemple.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
});

function exportData(type) {
  let rows = [];
  if (type === 'projects') {
    if (state.page === 'portfolio' && ['direction', 'pmo'].includes(roleKeyFor(state.user))) {
      rows = [
        ['Référence', 'Projet', 'Secteur', 'Wilaya', 'AE (Md DA)', 'Physique (%)', 'Financier (%)', 'Écart (pts)', 'État'],
        ...referenceProjects.map((project) => [
          project.id,
          project.name,
          project.sector,
          project.wilayas.join(', '),
          project.aeCurrent,
          project.physical,
          project.financial,
          project.financial - project.physical,
          referenceStatus(project)
        ])
      ];
    } else {
      const financialAccess = canViewFinancialData();
      const headers = ['Référence', 'Projet', 'Secteur', 'Wilaya', 'Maître d’ouvrage'];
      if (financialAccess) headers.push('AE initiale (Md DA)', 'AE actuelle (Md DA)', 'Avancement financier (%)');
      headers.push('Avancement physique (%)', 'Fin contractuelle', 'État');
      rows = [headers, ...allScopedProjects().map((project) => {
        const row = [project.id, project.name, project.sector, project.wilaya, project.owner];
        if (financialAccess) row.push(project.budgetInitial, project.budgetRevised, project.financial);
        row.push(project.physical, project.end, project.status);
        return row;
      })];
    }
  } else if (type === 'kpis') {
    const hasSnapshot = (state.kpiFilters.reportingDate || '2026-11') === '2026-11';
    const selectedProject = scopedProjectIds().has(state.kpiFilters.project) ? projectById(state.kpiFilters.project) : null;
    rows = [['KPI_ID', 'Nom_KPI', 'Importance', 'Phase', 'Valeur illustrative', 'Unité', 'Droit', 'Sens', 'Vert', 'Orange', 'Rouge'], ...visibleKPIs().map((item) => {
      const value = hasSnapshot ? valueFor(item, selectedProject) : '—';
      return [item.KPI_ID, item.Nom_KPI, item.Importance, item.Phase, formatValue(item, value), item.Unité, rolePermission('kpis', item.KPI_ID), item.Sens, item.Vert, item.Orange, item.Rouge];
    })];
  } else {
    rows = [['Type', 'Périmètre', 'Date', 'Note'], [type, role().name, '2026-11-13', 'Rapport illustratif TAQADDUM']];
  }
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  const isReferencePortfolio = type === 'projects' && state.page === 'portfolio' && ['direction', 'pmo'].includes(roleKeyFor(state.user));
  anchor.download = isReferencePortfolio ? 'taqaddum-portefeuille-reference.csv' : `taqaddum-${type}-illustratif.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
  appToast(isReferencePortfolio
    ? `Export CSV généré à partir des ${referenceProjects.length} fiches de référence locales.`
    : 'Export CSV généré à partir des données locales de démonstration.');
}

function start() {
  render();
}

try {
  start();
} catch (error) {
  renderFatal(error);
}
