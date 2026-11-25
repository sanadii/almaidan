import { isAlmaidanLocalDevelopment } from '../lib/local-development';

import { Component, lazy, Suspense, useEffect, useLayoutEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { ThemeProvider } from './ThemeProvider';
import { listenForSoundActivation } from '../lib/sound';
import { InternalHeader } from '../design-system/InternalHeader';
import { PublicFooter } from '../design-system/PublicFooter';
import { StatusToastProvider } from '../design-system/StatusToast';
import { EpisodeNavigation } from '../features/episodes/episode-navigation';
import { DeferredFirebaseAuthProvider } from '../features/auth/auth-context';
import { EntryRoute } from '../routes/EntryRoute';
import { PgRuntimeContext } from '../features/game/runtime/room-context';
import type { PgGameAdapter } from '../features/game/runtime/pg-game-adapter';
import {
  isStaticPreviewBuild,
  staticPreviewNotice,
} from '../features/game/runtime/static-preview';

const EntaRoomJoinRoute = lazy(() => import('../features/enta/RoomRoutes').then(({ EntaRoomJoinRoute }) => ({ default: EntaRoomJoinRoute })));
const EntaRoomRoute = lazy(() => import('../features/enta/RoomRoutes').then(({ EntaRoomRoute }) => ({ default: EntaRoomRoute })));
const LocalAdminRoute = lazy(() => import('../features/local-admin/LocalAdminRoute').then(({ LocalAdminRoute }) => ({ default: LocalAdminRoute })));
const LocalRematchRoute = lazy(() => import('../features/enta/LocalRematchRoute').then(({ LocalRematchRoute }) => ({ default: LocalRematchRoute })));
const HuroofRematch = lazy(() => import('../features/game/HuroofRematch').then(({ HuroofRematch }) => ({ default: HuroofRematch })));
const HostNewRoute = lazy(() => import('../routes/GameRoutes').then(({ HostNewRoute }) => ({ default: HostNewRoute })));
const NameJoinRoute = lazy(() => import('../routes/NameJoinRoute').then(({ NameJoinRoute }) => ({ default: NameJoinRoute })));
const HowToPlayRoute = lazy(() => import('../routes/GameRoutes').then(({ HowToPlayRoute }) => ({ default: HowToPlayRoute })));
const NotFoundRoute = lazy(() => import('../routes/GameRoutes').then(({ NotFoundRoute }) => ({ default: NotFoundRoute })));
const RoomRoute = lazy(() => import('../routes/GameRoutes').then(({ RoomRoute }) => ({ default: RoomRoute })));
const ImposterNewRoute = lazy(() => import('../features/imposter/ImposterRoutes').then(({ ImposterNewRoute }) => ({ default: ImposterNewRoute })));
const ImposterRoomRoute = lazy(() => import('../features/imposter/ImposterRoutes').then(({ ImposterRoomRoute }) => ({ default: ImposterRoomRoute })));
const ImposterTutorialRoute = lazy(() => import('../features/imposter/ImposterRoutes').then(({ ImposterTutorialRoute }) => ({ default: ImposterTutorialRoute })));
const AccountRoute = lazy(() => import('../routes/AuthRoutes').then(({ AccountRoute }) => ({ default: AccountRoute })));
const LoginRoute = lazy(() => import('../routes/AuthRoutes').then(({ LoginRoute }) => ({ default: LoginRoute })));
const AdminOverviewRoute = lazy(() => import('../features/admin/AdminRoutes').then(({ AdminOverviewRoute }) => ({ default: AdminOverviewRoute })));
const AdminQuestionEditorRoute = lazy(() => import('../features/admin/AdminRoutes').then(({ AdminQuestionEditorRoute }) => ({ default: AdminQuestionEditorRoute })));
const AdminPublishedCategoriesRoute = lazy(() => import('../features/admin/AdminRoutes').then(({ AdminPublishedCategoriesRoute }) => ({ default: AdminPublishedCategoriesRoute })));
const AdminPublishedQuestionsRoute = lazy(() => import('../features/admin/AdminRoutes').then(({ AdminPublishedQuestionsRoute }) => ({ default: AdminPublishedQuestionsRoute })));
const AdminRecordRoute = lazy(() => import('../features/admin/AdminRoutes').then(({ AdminRecordRoute }) => ({ default: AdminRecordRoute })));
const AdminRootRedirect = lazy(() => import('../features/admin/AdminRoutes').then(({ AdminRootRedirect }) => ({ default: AdminRootRedirect })));
const AdminSettingsRoute = lazy(() => import('../features/admin/AdminRoutes').then(({ AdminSettingsRoute }) => ({ default: AdminSettingsRoute })));
const AdminShell = lazy(() => import('../features/admin/AdminRoutes').then(({ AdminShell }) => ({ default: AdminShell })));
const AdminUsersRoute = lazy(() => import('../features/admin/AdminRoutes').then(({ AdminUsersRoute }) => ({ default: AdminUsersRoute })));
const LegacyQuestionRedirect = lazy(() => import('../features/admin/AdminRoutes').then(({ LegacyQuestionRedirect }) => ({ default: LegacyQuestionRedirect })));
const LocalImportReviewRoute = lazy(() => import('../routes/LocalImportReviewRoute').then(({ LocalImportReviewRoute }) => ({ default: LocalImportReviewRoute })));
const ContactRoute = lazy(() => import('../routes/ContactRoute').then(({ ContactRoute }) => ({ default: ContactRoute })));
const MediaCreditsRoute = lazy(() => import('../routes/MediaCredits').then(({ MediaCreditsRoute }) => ({ default: MediaCreditsRoute })));
const EpisodesRoute = lazy(() => import('../routes/EpisodesRoute').then(({ EpisodesRoute }) => ({ default: EpisodesRoute })));
const EntaNewRoute = lazy(() => import('../routes/EntaRoutes').then(({ EntaNewRoute }) => ({ default: EntaNewRoute })));
const EntaKidsRoute = lazy(() => import('../routes/EntaRoutes').then(({ EntaKidsRoute }) => ({ default: EntaKidsRoute })));
const EntaHistoryRoute = lazy(() => import('../features/enta/HistoryRoutes').then(({ EntaHistoryRoute }) => ({ default: EntaHistoryRoute })));
const OriginalResultRoute = lazy(() => import('../features/enta/OriginalResultRoute').then(({ OriginalResultRoute }) => ({ default: OriginalResultRoute })));
const EntaRematchRoute = lazy(() => import('../features/enta/HistoryRoutes').then(({ EntaRematchRoute }) => ({ default: EntaRematchRoute })));
const EntaMatchRoute = lazy(() => import('../routes/EntaRoutes').then(({ EntaMatchRoute }) => ({ default: EntaMatchRoute })));
const EntaResultRoute = lazy(() => import('../routes/EntaRoutes').then(({ EntaResultRoute }) => ({ default: EntaResultRoute })));
const EntaDrawingNewRoute = lazy(() => import('../features/enta/RoundRoutes').then(({ EntaDrawingNewRoute }) => ({default:EntaDrawingNewRoute})));
const EntaRoundNewRoute = lazy(() => import('../features/enta/RoundRoutes').then(({ EntaRoundNewRoute }) => ({ default: EntaRoundNewRoute })));
const EntaRoundMatchRoute = lazy(() => import('../features/enta/RoundRoutes').then(({ EntaRoundMatchRoute }) => ({ default: EntaRoundMatchRoute })));
const EntaRoundResultRoute = lazy(() => import('../features/enta/RoundRoutes').then(({ EntaRoundResultRoute }) => ({ default: EntaRoundResultRoute })));
const EntaCapabilityRoute = lazy(() => import('../features/enta/CapabilityRoute').then(({ EntaCapabilityRoute }) => ({ default: EntaCapabilityRoute })));

const EntaCompetitionNewRoute = lazy(() => import('../features/enta/CompetitionSetup').then(({ EntaCompetitionNewRoute }) => ({ default: EntaCompetitionNewRoute })));
const EntaCompetitionMatchRoute = lazy(() => import('../features/enta/CompetitionRoutes').then(({ EntaCompetitionMatchRoute }) => ({ default: EntaCompetitionMatchRoute })));
const EntaCompetitionResultRoute = lazy(() => import('../features/enta/CompetitionRoutes').then(({ EntaCompetitionResultRoute }) => ({ default: EntaCompetitionResultRoute })));
const EntaCompetitionCapabilityRoute = lazy(() => import('../features/enta/CompetitionCapability').then(({ EntaCompetitionCapabilityRoute }) => ({ default: EntaCompetitionCapabilityRoute })));

type RouteStatusSurfaceProps = {
  action?: ReactNode;
  busy?: boolean;
  message: ReactNode;
  messageRole?: "alert" | "status";
  title: string;
};

function RouteStatusSurface({
  action,
  busy = false,
  message,
  messageRole = "status",
  title,
}: RouteStatusSurfaceProps) {
  const titleId = `route-status-${messageRole}-title`;
  return (
    <main data-page-layout="wide"
      aria-busy={busy || undefined}
      aria-live={busy ? "polite" : undefined}
      className="maydan-app maydan-public-page"
      id="main-content"
      tabIndex={-1}
    >
      <InternalHeader />
      <section className="maydan-status-panel" data-state={busy ? 'loading' : messageRole} aria-labelledby={titleId}>
        <div>
          <p className="eyebrow">الميدان</p>
          <h1 id={titleId}>{title}</h1>
          <p className="form-message" role={messageRole}>{message}</p>
          {action}
        </div>
      </section>
    </main>
  );
}

export function RouteLoading() {
  return <RouteStatusSurface busy message="يُرجى الانتظار بينما نجهّز الصفحة." title="جارٍ تحميل الصفحة…" />;
}

export function StaticPreviewUnavailableRoute() {
  return <RouteStatusSurface message={staticPreviewNotice} title="هذه الخدمة غير متاحة في المعاينة" />;
}

const isChunkLoadFailure = (error: unknown) => error instanceof Error && (error.name === 'ChunkLoadError' || /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i.test(error.message));

/**
 * Catches route render and lazy-chunk failures. Navigating to another path (`resetKey`) clears
 * the failure so header links keep working after an error instead of leaving the error screen up.
 */
export class RouteChunkBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean; chunk: boolean; failedAt?: string }> {
  state: { failed: boolean; chunk: boolean; failedAt?: string } = { failed: false, chunk: true };
  static getDerivedStateFromError(error: unknown) { return { failed: true, chunk: isChunkLoadFailure(error) }; }
  static getDerivedStateFromProps(props: { resetKey?: string }, state: { failed: boolean; failedAt?: string }) {
    if (!state.failed) return state.failedAt === props.resetKey ? null : { failedAt: props.resetKey };
    return state.failedAt !== props.resetKey ? { failed: false, chunk: true, failedAt: props.resetKey } : null;
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <RouteStatusSurface
        action={<button className="button button--primary" onClick={() => window.location.reload()} type="button">إعادة المحاولة</button>}
        message={this.state.chunk ? "تحقق من الاتصال ثم أعد المحاولة." : "حدث خطأ غير متوقع في هذه الصفحة. أعد المحاولة أو انتقل إلى صفحة أخرى."}
        messageRole="alert"
        title="تعذر تحميل الصفحة"
      />
    );
  }
}

function RouteBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <RouteChunkBoundary resetKey={pathname}>{children}</RouteChunkBoundary>;
}

/** New pages open at the top (or at their #anchor); back/forward keeps the browser's position. */
export function RouteScrollManager() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();
  useLayoutEffect(() => {
    if (navigationType === 'POP') return;
    if (!hash) { window.scrollTo(0, 0); return; }
    const id = decodeURIComponent(hash.slice(1));
    let frame = 0; let attempts = 0;
    const find = () => {
      const target = document.getElementById(id);
      if (target) { target.scrollIntoView(); return; }
      if (++attempts < 20) frame = window.requestAnimationFrame(find);
    };
    find();
    return () => window.cancelAnimationFrame(frame);
  }, [pathname, hash, navigationType]);
  return null;
}

/** Pages whose header shows the account (or that act on it) load auth on a direct visit too. */
const authPathPrefixes = ['/admin', '/enta/', '/history', '/host/new', '/huroof/', '/room/', '/how-to-play', '/contact', '/episodes', '/media-credits'];

export function RouteAuthRuntime({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  if (['/enta/capability', '/enta/competitive/capability'].includes(pathname.replace(/\/$/, '').toLowerCase())) return <>{children}</>;
  return <DeferredFirebaseAuthProvider enabled={!isStaticPreviewBuild() && (isAlmaidanLocalDevelopment || pathname === '/' || pathname === '/login' || pathname === '/account' || authPathPrefixes.some(prefix => pathname.startsWith(prefix)))}>{children}</DeferredFirebaseAuthProvider>;
}

function RouteFooter() {
  const { pathname } = useLocation();
  const path = pathname.toLowerCase().replace(/\/+$/, '');
  const consoleRoute = /^\/(?:local-admin|local-import-review|admin|questions)(?:\/|$)/.test(path);
  const roomStage = /^\/(?:enta\/rooms|room)\/[^/]+\/(?:display|host|play|imposter)$/.test(path);
  const entaStage = /^\/enta\/(?:competitive\/)?(?:round-)?matches\/[^/]+$/.test(path);
  const capability = /^\/enta\/(?:competitive\/)?capability$/.test(path);
  return !path || consoleRoute || roomStage || entaStage || capability ? null : <PublicFooter />;
}

function HostSetupRoute() {
  const location = useLocation();
  return new URLSearchParams(location.search).get('kind') === 'imposter' ? <ImposterNewRoute /> : <HostNewRoute />;
}

export function App({ pgRuntime = null }: { pgRuntime?: PgGameAdapter | null } = {}) {
  useEffect(listenForSoundActivation, []);
  const staticPreview = isStaticPreviewBuild();
  const unavailable = <StaticPreviewUnavailableRoute />;
  return (
    <PgRuntimeContext.Provider value={pgRuntime}><ThemeProvider>
      <BrowserRouter>
        <RouteScrollManager />
        <EpisodeNavigation enabled={!staticPreview}>
        <StatusToastProvider>
        <RouteAuthRuntime>
          <RouteBoundary><Suspense fallback={<RouteLoading />}><Routes>
            <Route path="/" element={<EntryRoute />} />
            <Route path="/local-admin" element={isAlmaidanLocalDevelopment ? <LocalAdminRoute /> : <NotFoundRoute />} />
            <Route path="/enta/local-rematch/:engine/:id" element={isAlmaidanLocalDevelopment ? <LocalRematchRoute /> : <NotFoundRoute />} />
            <Route path="/room/:roomCode/join" element={<NameJoinRoute />} />
            <Route path="/how-to-play" element={<HowToPlayRoute />} />
            <Route path="/media-credits" element={<MediaCreditsRoute />} />
            <Route path="/contact" element={<ContactRoute />} />
            <Route path="/episodes" element={<EpisodesRoute />} />
            <Route path="/enta/competitive/new/classic" element={<EntaCompetitionNewRoute format="TIER_BOARD" />} />
            <Route path="/enta/competitive/new/mixed" element={<EntaCompetitionNewRoute format="MIXED_BOARD" />} />
            <Route path="/enta/competitive/new/list" element={<EntaCompetitionNewRoute format="STANDALONE_LIST" />} />
            <Route path="/enta/competitive/new/acting" element={<EntaCompetitionNewRoute format="STANDALONE_ACTING" />} />
            <Route path="/enta/competitive/matches/:id" element={<EntaCompetitionMatchRoute />} />
            <Route path="/enta/competitive/matches/:id/result" element={<EntaCompetitionResultRoute />} />
            <Route path="/enta/competitive/capability" element={<EntaCompetitionCapabilityRoute />} />
            <Route path="/enta/rooms/:code/join" element={<EntaRoomJoinRoute />} />
            <Route path="/enta/rooms/:code/host" element={<EntaRoomRoute host />} />
            <Route path="/enta/rooms/:code/play" element={<EntaRoomRoute />} />
            <Route path="/enta/rooms/:code/display" element={<EntaRoomRoute display />} />
            <Route path="/enta/new" element={<EntaNewRoute />} />
            <Route path="/enta/new/kids" element={<EntaKidsRoute />} />
            <Route path="/enta/new/drawing" element={<EntaDrawingNewRoute />} />
            <Route path="/enta/new/list" element={<EntaRoundNewRoute format="STANDALONE_LIST" />} />
            <Route path="/enta/new/acting" element={<EntaRoundNewRoute format="STANDALONE_ACTING" />} />
            <Route path="/enta/new/mixed" element={<EntaRoundNewRoute format="MIXED_BOARD" />} />
            <Route path="/enta/round-matches/:id" element={<EntaRoundMatchRoute />} />
            <Route path="/enta/round-matches/:id/result" element={<EntaRoundResultRoute />} />
            <Route path="/enta/capability" element={<EntaCapabilityRoute />} />
            <Route path="/enta/history" element={<EntaHistoryRoute />} />
            <Route path="/history" element={<EntaHistoryRoute />} />
            <Route path="/huroof/rematch/:id" element={isAlmaidanLocalDevelopment?<HuroofRematch/>:<NotFoundRoute/>} />
            <Route path="/enta/history/:id/original-result" element={<OriginalResultRoute />} />
            <Route path="/enta/matches/:id/rematch" element={<EntaRematchRoute />} />
            <Route path="/enta/matches/:id" element={<EntaMatchRoute />} />
            <Route path="/enta/matches/:id/result" element={<EntaResultRoute />} />
            <Route path="/host/new" element={<HostSetupRoute />} />
            <Route path="/how-to-play/imposter" element={<ImposterTutorialRoute />} />
            <Route path="/room/:roomCode/imposter" element={staticPreview ? unavailable : <ImposterRoomRoute />} />
            <Route path="/room/:roomCode/lobby" element={staticPreview ? unavailable : <RoomRoute surface="lobby" />} />
            <Route path="/room/:roomCode/host" element={staticPreview ? unavailable : <RoomRoute surface="host" />} />
            <Route path="/room/:roomCode/play" element={staticPreview ? unavailable : <RoomRoute surface="play" />} />
            <Route path="/room/:roomCode/display" element={staticPreview ? unavailable : <RoomRoute surface="display" />} />
            <Route path="/room/:roomCode/results" element={staticPreview ? unavailable : <RoomRoute surface="results" />} />
            <Route path="/local-import-review" element={staticPreview ? unavailable : <LocalImportReviewRoute />} />
            {isAlmaidanLocalDevelopment ? (
              <>
                <Route path="/admin/*" element={<Navigate replace to="/local-admin" />} />
                <Route path="/questions/*" element={<Navigate replace to="/local-admin" />} />
              </>
            ) : (
              <>
                <Route path="/questions" element={staticPreview ? unavailable : <Navigate replace to="/admin/questions" />} />
                <Route path="/questions/new" element={staticPreview ? unavailable : <Navigate replace to="/admin/drafts/new" />} />
                <Route path="/questions/:questionId" element={staticPreview ? unavailable : <LegacyQuestionRedirect />} />
                <Route path="/admin" element={staticPreview ? unavailable : <AdminRootRedirect />} />
                <Route path="/admin" element={staticPreview ? unavailable : <AdminShell />}>
                  <Route path="overview" element={<AdminOverviewRoute />} />
                  <Route path="questions" element={<AdminPublishedQuestionsRoute />} />
                  <Route path="questions/:id" element={<AdminPublishedQuestionsRoute />} />
                  <Route path="drafts" element={<AdminRecordRoute section="drafts" />} />
                  <Route path="drafts/new" element={<AdminQuestionEditorRoute />} />
                  <Route path="drafts/:questionId" element={<AdminQuestionEditorRoute />} />
                  <Route path="categories" element={<AdminPublishedCategoriesRoute />} /><Route path="categories/:id" element={<AdminPublishedCategoriesRoute />} />
                  <Route path="reviews" element={<AdminRecordRoute section="reviews" />} /><Route path="reviews/:id" element={<AdminRecordRoute section="reviews" />} />
                  <Route path="releases" element={<AdminRecordRoute section="releases" />} /><Route path="releases/:id" element={<AdminRecordRoute section="releases" />} />
                  <Route path="rooms" element={<AdminRecordRoute section="rooms" />} /><Route path="rooms/:id" element={<AdminRecordRoute section="rooms" />} />
                  <Route path="users" element={<AdminUsersRoute />} /><Route path="audit" element={<AdminRecordRoute section="audit" />} />
                  <Route path="health" element={<AdminRecordRoute section="health" />} /><Route path="settings" element={<AdminSettingsRoute />} />
                </Route>
              </>
            )}
            <Route path="/login" element={staticPreview ? unavailable : <LoginRoute />} />
            <Route path="/account" element={staticPreview ? unavailable : <AccountRoute />} />
            <Route path="*" element={<NotFoundRoute />} />
          </Routes><RouteFooter /></Suspense></RouteBoundary>
        </RouteAuthRuntime>
        </StatusToastProvider>
        </EpisodeNavigation>
      </BrowserRouter>
    </ThemeProvider></PgRuntimeContext.Provider>
  );
}
