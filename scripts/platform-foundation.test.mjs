import test from 'node:test';
import postcss from 'postcss';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
test('shared platform styles consume tokens instead of defining competing palettes', () => {
  const runtime = readFileSync(join(ROOT, 'src/platform/platformTheme.ts'), 'utf8');
  const definedTokens = new Set([...runtime.matchAll(/'(--xeno-theme-[\w-]+)'\s*:/g)].map(match => match[1]));
  const files = [
    'src/components/overview/overview-shell.css',
    'src/components/overview/platform-workbench.css',
    'src/components/overview/platform-theme.css',
    'src/components/modals/welcome-credit-bonus.css',
  ];
  for (const file of files) {
    const css = postcss.parse(readFileSync(join(ROOT, file), 'utf8'));
    css.walkDecls(declaration => {
      for (const match of declaration.value.matchAll(/var\((--xeno-theme-[\w-]+)/g)) {
        assert.ok(definedTokens.has(match[1]), `${file}: unresolved token ${match[1]}`);
      }
      assert.doesNotMatch(declaration.value, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i,
        `${file}: ${declaration.prop} must consume the shared palette`);
      if (declaration.parent.type === 'rule' && declaration.parent.selector.includes(':hover')) {
        assert.doesNotMatch(declaration.prop, /^border(?:-(?:top|right|bottom|left))?-color$/,
          `${file}: hover must not change the border color`);
      }
    });
  }
});
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const context = read('src', 'contexts', 'WorkspaceContext.tsx');
const team = read('src', 'components', 'account', 'TeamPage.tsx');
const routes = read('src', 'pages', 'Overview.tsx');
const commands = read('src', 'platform', 'platformCommands.ts');
const taskbar = read('src', 'components', 'overview', 'OverviewTaskbar.tsx');
const billing = read('src', 'components', 'account', 'BillingPage.tsx');
const dashboard = read('src', 'components', 'overview', 'Overview.tsx');
const dashboardRoute = read('src', 'server', 'routes', 'dashboardRoutes.js');
const workspaceRoutes = read('src', 'server', 'routes', 'workspaceRoutes.js');
const profile = read('src', 'components', 'account', 'ProfilePage.tsx');
const usage = read('src', 'components', 'account', 'UsageAnalyticsPage.tsx');
const resourceState = read('src', 'components', 'platform', 'ResourceState.tsx');
const platformStyles = read('src', 'components', 'overview', 'overview-shell.css');
const commandPalette = read('src', 'components', 'platform', 'PlatformCommandPalette.tsx');
const integrations = read('src', 'components', 'account', 'IntegrationsPage.tsx');
const auth = read('src', 'pages', 'Auth.tsx');
const authContent = read('src', 'pages', 'AuthContent.tsx');
const createLab = read('src', 'components', 'overview', 'CreateLabModal.tsx');
const settings = read('src', 'components', 'account', 'SettingsPage.tsx');
const accountRoutes = read('src', 'server', 'routes', 'accountRoutes.js');
const authRoutes = read('src', 'server', 'routes', 'authRoutes.js');
const accountService = read('src', 'services', 'accountService.ts');
const workbenchStyles = read('src', 'components', 'overview', 'platform-workbench.css');
const accountSettingsNav = read('src', 'components', 'account', 'AccountSettingsNav.tsx');
const drawerLayout = read('src', 'components', 'platform', 'DrawerLayoutControl.tsx');
const projects = read('src', 'components', 'account', 'ProjectsPage.tsx');
const platformTheme = read('src', 'platform', 'platformTheme.ts');
const platformThemePalette = read('src', 'platform', 'platformThemePalette.ts');
const themeStyles = read('src', 'components', 'overview', 'platform-theme.css');
const userDataService = read('src', 'services', 'userDataService.ts');
const userDataRoutes = read('src', 'server', 'routes', 'userDataRoutes.js');
const chatTheme = read('src', 'components', 'playground', 'Chat', 'chatTheme.ts');
const chat = read('src', 'components', 'playground', 'Chat', 'ChatWithLLM.tsx');
const searchChat = read('src', 'components', 'playground', 'Chat', 'SearchChatInterface.tsx');

test('account and workspace foundation never ships fabricated identities or security state', () => {
  const source = [context, team].join('\n');
  assert.doesNotMatch(source, /DEV_WORKSPACES|DEV_MEMBERS|DEV_INVITES|DEV_SESSIONS|Math\.random/);
  assert.doesNotMatch(source, /alice@example\.com|alex@xeno\.dev|Last changed 30 days ago/);
});
test('workspace switch is server-confirmed before local selection changes', () => {
  const start = context.indexOf('const switchWorkspace');
  const body = context.slice(start, context.indexOf('// Workspaces only exist', start));
  assert.ok(body.indexOf('await apiSelectWorkspace') < body.indexOf('setActiveWorkspace'));
});
test('team mutations reload only after confirmed success', () => {
  assert.match(team, /await operation\(\); await load\(\)/);
  assert.match(team, /The server did not confirm this change/);
});
test('platform command and capability ids are unique', () => {
  const commandIds = [...commands.matchAll(/id: '([^']+)'/g)].map((match) => match[1]);
  const capabilityIds = [...commands.matchAll(/capabilityId: '([^']+)'/g)].map((match) => match[1]);
  assert.equal(new Set(commandIds).size, commandIds.length);
  assert.equal(new Set(capabilityIds).size, capabilityIds.length);
  assert.ok(capabilityIds.includes('platform.dashboard.open'));
  assert.ok(capabilityIds.includes('platform.workspace.open_members'));
  assert.ok(capabilityIds.includes('platform.integrations.open'));
  assert.match(commands, /id: 'platform\.app\.status'/);
  assert.doesNotMatch(commands, /app\.quit/);
});
test('all command entry points open the same palette', () => {
  assert.match(taskbar, /onClick=\{onOpenCommandPalette\}/);
  assert.match(routes, /PlatformCommandPalette/);
  assert.match(routes, /event\.metaKey \|\| event\.ctrlKey/);
});
test('platform pages use a full-viewport workbench rather than a capped card canvas', () => {
  assert.match(routes, /platform-workbench\.css/);
  assert.match(workbenchStyles, /\.xeno-platform-page\s*\{[\s\S]*height: 100%/);
  assert.match(workbenchStyles, /\.xeno-platform-page-header\s*\{[\s\S]*position: sticky/);
  assert.match(workbenchStyles, /max-width: none/);
  assert.match(workbenchStyles, /\.xeno-project-toolbar\s*\{[\s\S]*position: sticky/);
  assert.doesNotMatch(workbenchStyles, /#(?:7657ff|20c6c9|ffb456|6d4cff|4777f4|6f56e8|4ea1ff|a78bfa)/i);
});
test('native controls and system brightness use the platform appearance', () => {
  assert.match(themeStyles, /input\[type="range"\][\s\S]*accent-color: var\(--xeno-theme-text\)/);
  assert.match(platformTheme, /preference === 'system'\s*\? getVisualThemePosition\(readSystemTheme\(\)\)/);
});

test('authenticated platform theme owns the former Chat palette and every overview route inherits it', () => {
  assert.match(routes, /usePlatformTheme/);
  assert.match(routes, /data-theme=\{platformTheme\}/);
  assert.match(routes, /\.\.\.platformThemeStyle/);
  assert.match(platformTheme, /userDataService\.getSettings\(\)/);
  assert.match(platformTheme, /appearance\.themeBrightness/);
  assert.match(platformTheme, /buildChatThemeStyle/);
  assert.match(platformThemePalette, /CHAT_THEME_SURFACE_PALETTES/);
  assert.match(platformTheme, /prefers-color-scheme: dark/);
  assert.match(platformTheme, /PLATFORM_THEME_EVENT/);
  assert.match(settings, /<option value="system">System<\/option>/);
  assert.match(settings, /<option value="dim">Dim<\/option>/);
  assert.match(settings, /savePlatformTheme/);
  assert.match(userDataService, /theme\?: 'system' \| 'custom' \| 'dark' \| 'dim' \| 'light'/);
  assert.match(userDataService, /themeBrightness\?: number/);
  assert.match(themeStyles, /\[data-theme="dim"\]/);
  assert.match(themeStyles, /color-scheme: dark/);
  assert.doesNotMatch(themeStyles, /--xeno-theme-[\w-]+:\s*(?:#|rgba?\()/);
  assert.match(platformTheme, /'--xeno-theme-surface-raised': tokens.elevated/);
  assert.match(platformTheme, /--xeno-theme-nav-hover/);
  assert.match(platformTheme, /--xeno-theme-text-hover/);
  assert.match(chat, /usePlatformTheme\(\)/);
  assert.match(searchChat, /usePlatformTheme\(\)/);
  assert.doesNotMatch(chat, /localStorage\.setItem\(['"]xeno-chat-theme/);
  assert.doesNotMatch(chatTheme, /useChatTheme|localStorage/);
  assert.match(chatTheme, /platformThemePalette/);
  assert.doesNotMatch(themeStyles, /#(?:0c0d0f|111316|141619|1b1e22|24282d|292d33|3a3f47)/i);
  assert.doesNotMatch(themeStyles, /#(?:7657ff|20c6c9|ffb456|6d4cff|4777f4|6f56e8|4ea1ff|a78bfa)/i);
});
test('sidebar hover and toggle states use semantic platform colors in every theme', () => {
  assert.match(themeStyles, /--xeno-shell-hover:\s*var\(--xeno-theme-nav-hover\)/);
  assert.match(themeStyles, /--xeno-shell-hover-ink:\s*var\(--xeno-theme-text-hover\)/);
  assert.match(platformStyles, /\.xeno-rail-button:hover,[\s\S]*?background:\s*var\(--xeno-shell-hover\);[\s\S]*?color:\s*var\(--xeno-shell-hover-ink\)/);
  assert.match(platformStyles, /\.xeno-rail-button\.is-active\s*\{\s*background:\s*var\(--xeno-shell-active\);\s*color:\s*var\(--xeno-shell-ink\)/);
  assert.match(platformStyles, /\.xeno-collapse-button:hover\s*\{\s*background:\s*var\(--xeno-shell-hover\);\s*color:\s*var\(--xeno-shell-hover-ink\)/);
  assert.match(platformStyles, /\.xeno-expand-tab:hover\s*\{\s*background:\s*var\(--xeno-shell-hover\);\s*color:\s*var\(--xeno-shell-hover-ink\)/);
  assert.doesNotMatch(platformStyles, /\.xeno-(?:rail-button|collapse-button|expand-tab)[^\{]*:hover[^\{]*\{[^\}]*(?:#eceef0|#111317|#15171a)/);
});
test('shared interaction states use role-specific theme tokens across the platform', () => {
  assert.match(platformTheme, /--xeno-theme-row-hover/);
  assert.match(platformTheme, /--xeno-theme-control-hover/);
  assert.match(platformTheme, /--xeno-theme-focus-ring/);
  assert.match(themeStyles, /\.xeno-project-list > button:hover[\s\S]*?var\(--xeno-theme-row-hover\)/);
  assert.match(themeStyles, /\.xeno-integration-card:hover[\s\S]*?var\(--xeno-theme-row-hover\)/);
  assert.match(themeStyles, /\.xeno-range-picker button\.is-active[\s\S]*?var\(--xeno-theme-inverse\)/);
  assert.match(themeStyles, /button, a\[href\], input, select, textarea\):focus-visible[\s\S]*?var\(--xeno-theme-focus-ring\)/);
  assert.match(workbenchStyles, /\.xeno-drawer-layout-menu > button:hover \{ background: var\(--xeno-theme-control-hover\); color: var\(--xeno-theme-text\); \}/);
  assert.match(platformStyles, /\.xeno-start-card:hover \{[^}]*background: var\(--xeno-theme-row-hover\);[^}]*background-color: var\(--xeno-theme-row-hover\);/);
  assert.match(platformStyles, /\.xeno-sidebar-scroll[^}]*scrollbar-color: var\(--xeno-theme-border-strong\) transparent/);
  assert.doesNotMatch(platformStyles, /\.xeno-start-card:hover\s*\{[^}]*(?:transform|box-shadow)/);
});
test('dashboard surfaces and icons resolve from the platform theme without light-only fallbacks', () => {
  const dashboardStyles = platformStyles.slice(
    platformStyles.indexOf('/* Dashboard */'),
    platformStyles.indexOf('@media (max-width: 1080px)'),
  );
  assert.doesNotMatch(dashboardStyles, /#[0-9a-f]{3,8}|rgba?\(/i);
  assert.doesNotMatch(dashboardStyles, /linear-gradient/i);
  assert.match(dashboardStyles, /\.xeno-card-icon[^}]*background:\s*var\(--xeno-theme-surface-muted\)[^}]*color:\s*var\(--xeno-theme-text\)/);
  assert.match(dashboardStyles, /\.xeno-section-title svg\s*\{\s*color:\s*currentColor/);
  assert.match(themeStyles, /\[data-overview-shell\] \.xeno-start-card,[\s\S]*?background-color:\s*var\(--xeno-theme-surface\)/);
  assert.match(themeStyles, /\[data-overview-shell\] \.xeno-start-card:hover[\s\S]*?background-color:\s*var\(--xeno-theme-row-hover\)/);
  assert.match(themeStyles, /\[data-overview-shell\] \.xeno-work-table th[\s\S]*?background:\s*var\(--xeno-theme-surface-subtle\)/);
  assert.doesNotMatch(dashboard, /style=\{\{[^}]*color:\s*['"]#/);
});
test('sidebar footer actions resolve from semantic platform theme states', () => {
  const footerStyles = platformStyles.slice(
    platformStyles.indexOf('.xeno-sidebar-bottom'),
    platformStyles.indexOf('.xeno-expand-tab'),
  );
  assert.doesNotMatch(footerStyles, /#[0-9a-f]{3,8}|rgba?\(/i);
  assert.match(footerStyles, /\.xeno-community-card[^}]*background-color:\s*var\(--xeno-theme-surface-subtle\)/);
  assert.match(footerStyles, /\.xeno-community-card:hover[^}]*background-color:\s*var\(--xeno-theme-row-hover\)/);
  assert.match(footerStyles, /\.xeno-account-avatar[^}]*background:\s*var\(--xeno-theme-surface-muted\)[^}]*color:\s*var\(--xeno-theme-text\)/);
  assert.match(themeStyles, /\[data-overview-shell\] \.xeno-community-card[^}]*background-color:\s*var\(--xeno-theme-surface-subtle\)/);
  assert.match(themeStyles, /\[data-overview-shell\] \.xeno-community-card:hover,[\s\S]*?background-color:\s*var\(--xeno-theme-nav-hover\)/);
  assert.match(themeStyles, /\[data-overview-shell\] \.xeno-account-avatar[^}]*background:\s*var\(--xeno-theme-surface-muted\)/);
});
test('theme changes apply only after the server confirms the setting', () => {
  const start = platformTheme.indexOf('export const savePlatformTheme');
  const body = platformTheme.slice(start, platformTheme.indexOf('export const buildPlatformThemeStyle', start));
  assert.ok(body.indexOf('await userDataService.updateSettingsBatch') < body.indexOf('announcePlatformTheme'));
  assert.match(body, /appearance\.themeBrightness/);
  assert.match(userDataService, /async updateSettingsBatch/);
  assert.match(userDataRoutes, /Array\.isArray\(updates\)/);
  assert.match(userDataRoutes, /normalizedUpdates\.reduce/);
  assert.match(userDataRoutes, /SELECT settings FROM user_settings WHERE user_id = \$1 FOR UPDATE/);
});
test('account settings share one navigable section bar', () => {
  assert.match(accountSettingsNav, /Profile/);
  assert.match(accountSettingsNav, /Preferences/);
  assert.match(accountSettingsNav, /Integrations/);
  assert.match(accountSettingsNav, /Billing/);
  assert.match(profile, /AccountSettingsNav/);
  assert.match(settings, /AccountSettingsNav/);
  assert.match(integrations, /AccountSettingsNav/);
});
test('real resource details support side and full-page layouts', () => {
  assert.match(drawerLayout, /'side' \| 'full'/);
  assert.match(drawerLayout, /Side drawer/);
  assert.match(drawerLayout, /Full page/);
  assert.match(projects, /DrawerLayoutControl/);
  assert.match(integrations, /DrawerLayoutControl/);
  assert.match(workbenchStyles, /xeno-detail-drawer\.is-fullpage/);
});
test('universal command menu exposes real registry groups and explicit readable states', () => {
  assert.match(commandPalette, /\['All', 'Resources', 'Navigate', 'Workspace', 'Account'\]/);
  assert.match(commandPalette, /listProjects/);
  assert.match(commandPalette, /listWorkspaces/);
  assert.match(commandPalette, /item\.group !== group/);
  assert.match(commandPalette, /Search anything or enter a command/);
  assert.match(platformStyles, /xeno-command-results>button\{color:var\(--xeno-theme-text\)/);
  assert.match(platformStyles, /xeno-command-input-row input\{background:transparent;color:var\(--xeno-theme-text\)/);
  assert.doesNotMatch(platformStyles, /#(?:7657ff|20c6c9|ffb456|6d4cff|4777f4|6f56e8|4ea1ff|a78bfa)/i);
});
test('billing uses the shared themed platform composition', () => {
  assert.match(billing, /xeno-platform-page xeno-billing-page/);
  assert.match(billing, /xeno-billing-plan-card/);
  assert.match(billing, /xeno-credit-card/);
  assert.doesNotMatch(platformStyles, /xeno-billing-plan-card::before/);
  assert.match(billing, /xeno-billing-content/);
  assert.match(platformStyles, /xeno-billing-content\{[^}]*margin-inline:24px/);
  assert.match(platformStyles, /xeno-billing-content\{margin-inline:14px/);
  assert.match(themeStyles, /xeno-billing-plan-card/);
  assert.match(billing, /layout="page" previewLabel="Account \/ Billing"/);
  assert.doesNotMatch(billing, /bg-black\/40/);
});
test('notifications and integrations are platform routes', () => {
  assert.match(routes, /path="notifications" element=\{<NotificationsPage/);
  assert.match(routes, /path="integrations" element=\{<IntegrationsPage/);
  assert.match(taskbar, /\/overview\/notifications/);
  assert.match(taskbar, /\/overview\/integrations/);
});
test('integrations show only authenticated server-qualified connector records', () => {
  assert.match(integrations, /chatService\.getConnectors\(\)/);
  assert.match(integrations, /No qualified integrations/);
  assert.doesNotMatch(integrations, /const integrations\s*=|name: 'GitHub'|name: 'Calendar'|name: 'Cloud storage'/);
});
test('projects use the persisted chat-project contract and remain workspace scoped', () => {
  assert.match(accountService, /\/chat\/projects/);
  assert.doesNotMatch(accountService, /\/account\/projects/);
  assert.match(routes, /ProjectsPage/);
  assert.match(read('src', 'server', 'routes', 'chatRoutes.js'), /p\.workspace_id = \$2::uuid/);
});
test('session absence and service failure are distinct states', () => {
  assert.match(settings, /Session service unavailable/);
  assert.match(settings, /server confirmed that this account has no active sessions/);
  assert.match(accountRoutes, /DELETE \/api\/account\/sessions\/\:id/);
  assert.match(accountRoutes, /user_id = \$2/);
});
test('usage totals come from the canonical double-entry ledger', () => {
  assert.match(authRoutes, /creditsView/);
  assert.match(authRoutes, /credit_transactions/);
  assert.doesNotMatch(authRoutes, /totalCreditsEarned\s*-\s*currentCredits/);
});
test('sign-in does not expose sign-up-only controls to assistive technology', () => {
  assert.match(auth, /activeTab === 'signup' \? <div/);
  assert.match(authContent, /activeTab === 'signup' \? <div/);
  assert.doesNotMatch(auth, /activeTab === 'signup' \? 'max-h-24/);
  assert.doesNotMatch(authContent, /activeTab === 'signup' \? 'max-h-24/);
});
test('implemented routes do not impersonate unavailable products or fabricate labs', () => {
  assert.doesNotMatch(routes, /Coming Soon|TikTok Channel Manager|Lab Editor|mockLabs|Lab card placeholder/);
  assert.match(routes, /Spreadsheets live in XENO Sheets/);
  assert.match(routes, /Scheduling belongs to XENO Post/);
  assert.doesNotMatch(createLab, /setTimeout|Date\.now|navigate\(`\/overview\/labs/);
  assert.match(createLab, /Nothing will be fabricated in browser state/);
});
test('billing redirect is not treated as evidence of payment', () => {
  assert.doesNotMatch(billing, /no charge was made|your plan is active/);
  assert.match(billing, /await getCheckoutStatus\(sessionId\)/);
  assert.match(billing, /checkout === 'fulfilled' \? 'Payment confirmed/);
  assert.match(billing, /if \(!s\) throw new Error/);
  assert.match(billing, /Payment processing may still be pending/);
  assert.match(billing, /finally[\s\S]*setLoading\(false\)/);
  assert.match(billing, /Refresh billing/);
});
test('workspace-bound reads discard stale responses and clear prior workspace collections', () => {
  assert.match(dashboard, /const generation = \+\+loadGeneration\.current/);
  assert.match(dashboard, /if \(generation !== loadGeneration\.current\) return/);
  assert.match(team, /setInvites\(\[\]\);\s*setEvents\(\[\]\);/);
  assert.match(projects, /const generation = \+\+loadGeneration\.current/);
  assert.match(projects, /activeWorkspaceId\.current !== workspaceId \|\| generation !== loadGeneration\.current/);
  assert.match(projects, /loadedWorkspaceId === activeWorkspace\?\.id/);
  assert.ok((projects.match(/if \(activeWorkspaceId\.current !== workspaceId\) return/g) || []).length >= 3);
});
test('unavailable usage remains unavailable instead of becoming a false zero', () => {
  assert.match(dashboardRoute, /const requests30d = usage \?[^;]+: null;/);
  assert.match(dashboardRoute, /usage_available: Boolean\(usage\)/);
  assert.match(dashboard, /value === null \? '—'/);
});
test('account pages distinguish loading, signed-out, error, empty, and confirmed states', () => {
  assert.match(profile, /if \(isLoading\)/);
  assert.match(profile, /if \(!user\)/);
  assert.match(profile, /Your profile is waiting for you/);
  assert.doesNotMatch(profile, /if \(!user\)[\s\S]{0,180}animate-spin/);
  assert.match(usage, /if \(authLoading\)/);
  assert.match(usage, /if \(!user\)/);
  assert.match(usage, /if \(state === 'error' \|\| !data\)/);
  assert.doesNotMatch(usage, /Claim Now|Claim 1,000 free credits/);
  assert.doesNotMatch(usage, /usageData\?\.[^\n]+\|\| 0/);
});
test('full-page issue states use the shared split recovery composition', () => {
  assert.match(resourceState, /layout\?: 'inline' \| 'page'/);
  assert.match(resourceState, /xeno-resource-preview/);
  assert.match(resourceState, /secondaryActionLabel/);
  assert.match(profile, /layout="page" previewLabel="Account \/ Profile"/);
  assert.match(usage, /layout="page" previewLabel="Account \/ Usage"/);
  assert.match(team, /layout="page" previewLabel="Workspace \/ Members"/);
  assert.match(platformStyles, /xeno-resource-state\.is-page/);
  assert.match(platformStyles, /grid-template-columns:minmax\(0,\.96fr\)/);
});
test('workspace lifecycle mutations are transaction-bound, serialized, and audited', () => {
  assert.match(workspaceRoutes, /import \{ withTransaction \}/);
  assert.match(workspaceRoutes, /async function auditStrict/);
  assert.ok((workspaceRoutes.match(/withTransaction\(req\.db/g) || []).length >= 8);
  assert.ok((workspaceRoutes.match(/FOR UPDATE/g) || []).length >= 7);
  assert.match(workspaceRoutes, /await auditStrict\(tx, wsId, req\.user\.id, 'owner\.transfer'/);
  assert.match(workspaceRoutes, /await auditStrict\(tx, inv\.workspace_id, req\.user\.id, 'invite\.accept'/);
  assert.doesNotMatch(workspaceRoutes, /persisted best-effort/);
});
