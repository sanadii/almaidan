import '../styles/game-guide.css';
import '../styles/huroof-lobby.css';
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as QRCode from "qrcode";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { InternalHeader as AppHeader } from "../design-system/InternalHeader";
import { GameArtwork } from "../design-system/GameArtwork";
import { RoomCode } from "../design-system/RoomCode";
import { ConfirmDialog } from "../design-system/ConfirmDialog";
import { useCopyStatus } from "../design-system/StatusToast";
import { StatusArt, StatusHomeLink, StatusPage } from "../design-system/StatusPanel";
import { Icon } from '../design-system/Icon';
import { GameplayPreferences } from '../design-system/SoundToggle';
import { useDeadlineSound, useGameSoundTransition } from '../features/ui/game-sound';
import type { SoundCue, SoundRole } from '../lib/sound';
import { QuestionReveal } from "../features/ui/QuestionReveal";
import {isYouTubeMediaDescriptor,youtubeEmbedUrl,type YouTubeMediaDescriptor} from '../features/game/runtime/youtube-media';
import { ChallengeStage } from "../features/game/challenges/ChallengeStage";
import {
  availableCategoryCatalog as legacyAvailableCategoryCatalog,
  categoryCatalog,
} from "../data/category-catalog";
import {
  fetchLocalQuestionInventory,
  catalogCategoryCovers,
  inventoryCategoryCovers,
  staticPreviewQuestionInventory,
  type LocalQuestionInventory,
} from "../data/local-question-inventory";
import {
  categoryTopicIdForCategory,
  categoryTopics,
  filterCategories,
  type CategoryTopicId,
} from "../data/category-filters";
import {
  approvedCategoryPlayable,
  categoryChallengeKinds,
  localCategoryPlayable,
} from "../data/category-playability";
import { GameBoard, type BoardCell, type BoardPresentationContext } from "../features/board/game-board";
import { generateBoard } from "../features/game/domain/board";
import { CORRECTABLE_STATES } from "../features/game/domain/lifecycle";
import {
  matchModeOptions,
  matchModeTiming,
  parseSetupQuery,
  setupGameKindOptions,
  setupQueryString,
} from "../features/game/setup-options";
import { connectionLabel, stateLabel } from "../features/ui/game-state";
import type {
  HostPresenceSnapshot,
  ApprovedReleaseCatalog,
  ChallengeMechanic,
  IntentType,
  PlayerPresenceState,
  ProjectionEnvelope,
  SafeProjection,
} from "../features/game/runtime/contracts";
import { CLIENT_CHALLENGE_CAPABILITY } from "../features/game/runtime/contracts";
import { useFirebaseAuth } from '../features/auth/auth-context';
import { isAlmaidanLocalDevelopment } from '../lib/local-development';
import type { CreateRoomRequest } from '../features/game/runtime/contracts';
import {parseLocalCreationPending,localCreationKey} from '../features/game/runtime/local-creation-pending';
import {ownerEpoch,assertOwnerEpoch,isOwnerEpoch,type OwnerEpoch} from '../features/enta/auth-epoch';
import {LocalRoomCreationFailure} from '../features/game/runtime/local-realtime-game-adapter';
import { gameRuntime } from "../features/game/runtime";
import { PgRuntimeContext } from "../features/game/runtime/room-context";
import { parseRoomLocator } from "../features/game/runtime/room-locator";
import { audienceCapabilityFor, capabilityFor, forgetRoomCapability, huroofSessionsCleared, saveAudienceCapability, saveCapability, savedRoomId, saveRoomCode } from "../features/game/runtime/huroof-session";
import { isTerminalRoomError, roomErrorCode, roomRequestError } from "../features/game/runtime/room-request-error";
import { isRoomUuid, parseRematchOwnerAccess } from "../features/game/huroof-rematch-client";
import { JOIN_NAME_MESSAGE, normalizePlayerDisplayName } from "../features/game/runtime/display-name";
import { useHuroofRematch } from "../features/game/use-huroof-rematch";
import { HuroofRematchJoin } from "../features/game/HuroofRematch";
import { createGameIntentId } from "../features/game/runtime/game-intent-id";
import {
  isStaticPreviewBuild,
  staticPreviewNotice,
} from "../features/game/runtime/static-preview";

type ViewProjection = SafeProjection & {
  question?: {
    headerAr?: string;
    promptAr?: string;
    primaryAnswer?: string;
    acceptedAnswers?: string[];
    revealedAnswer?: string;
    occurrence?: string;
    sources?: Array<{ title?: string; url?: string }>;
    media?: { mediaId: string; assetSha256: string; altAr: string; type?: "image" | "video"; contentType?: string; audiencePresentation?: "clear" | "concealed" };
  };
  audit?: Array<{ revision: number; type: string; payload?: unknown }>;
};
type CurrentQuestionMediaGrant = {
  mediaId: string;
  assetSha256: string;
  url: string;
  expiresAt: string;
  youtube?: YouTubeMediaDescriptor;
};
type CurrentQuestionMediaRequest = {
  roomId: string;
  mediaId: string;
  assetSha256: string;
};
type QuestionMediaBinding = {
  mediaId: string;
  assetSha256: string;
  altAr: string;
  type?: "image" | "video";
  contentType?: string;
  /** New reviewed prompt stimuli may be readable on the audience display. Legacy media stays concealed. */
  audiencePresentation?: "clear" | "concealed";
};

/**
 * Old immutable bindings have a declared type, while newer releases also bind
 * a MIME type.  Treat either authoritative video signal as a video so the
 * audience never applies the image concealment treatment to a clear reveal.
 */
export const isQuestionMediaVideo = (media: Pick<QuestionMediaBinding, "type" | "contentType">) =>
  media.type === "video" || media.contentType?.toLowerCase().startsWith("video/") === true;

/**
 * Legacy image prompts remain concealed. A release can opt in only a reviewed,
 * answer-safe prompt binding with the explicit immutable `clear` value.
 */
export const shouldConcealAudienceQuestionMedia = (media: Pick<QuestionMediaBinding, "type" | "contentType" | "audiencePresentation">) =>
  !isQuestionMediaVideo(media) && media.audiencePresentation !== "clear";

/** Answers belong to the host, never to the audience display. */
export const shouldShowSharedRevealedAnswer = () =>
  true;

const revokeObjectUrl = (url: string) => {
  if (url.startsWith("blob:") && typeof URL.revokeObjectURL === "function")
    URL.revokeObjectURL(url);
};

const pgMediaUnavailable = async (): Promise<CurrentQuestionMediaGrant> => { throw new Error("MEDIA_UNAVAILABLE"); };

/** Loads only a current server-authorized grant and clears it before its bearer expiry. */
export function CurrentQuestionMedia({
  roomId,
  media,
  load,
  concealed = false,
}: {
  roomId: string;
  media: QuestionMediaBinding;
  load?: (
    request: CurrentQuestionMediaRequest,
  ) => Promise<CurrentQuestionMediaGrant>;
  concealed?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [youtube, setYoutube] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const activeUrl = useRef("");
  const activeBinding = useRef("");
  const youtubeExpiryTimer = useRef<number | undefined>(undefined);
  const binding = `${roomId}\u0000${media.mediaId}\u0000${media.assetSha256}`;
  const request = useCallback(() => {
    const value = {
      roomId,
      mediaId: media.mediaId,
      assetSha256: media.assetSha256,
    };
    if (load) return load(value);
    // Keep the adapter receiver intact: both local and deferred adapters use this.
    return (
      gameRuntime.getCurrentQuestionMedia?.(value) ??
      Promise.reject(new Error("MEDIA_UNAVAILABLE"))
    );
  }, [load, media.assetSha256, media.mediaId, roomId]);
  // A reauthorization for the same immutable video must not replace its Blob
  // URL: replacing src would make the native autoplay attribute replay it.
  useEffect(
    () => () => {
      revokeObjectUrl(activeUrl.current);
      activeUrl.current = "";
      activeBinding.current = "";
      if (youtubeExpiryTimer.current !== undefined) window.clearTimeout(youtubeExpiryTimer.current);
      youtubeExpiryTimer.current = undefined;
    },
    [binding],
  );
  useEffect(() => {
    let alive = true;
    let receivedUrl = "";
    let refreshTimer: number | undefined;
    const failAndClear = () => {
      revokeObjectUrl(activeUrl.current);
      activeUrl.current = '';
      activeBinding.current = '';
      if (youtubeExpiryTimer.current !== undefined) window.clearTimeout(youtubeExpiryTimer.current);
      youtubeExpiryTimer.current = undefined;
      setUrl(''); setYoutube(false); setFailed(true);
    };
    const preserveVideo =
      isQuestionMediaVideo(media) &&
      activeBinding.current === binding &&
      Boolean(activeUrl.current);
    if (!preserveVideo) {
      setUrl("");
      setYoutube(false);
      setFailed(false);
    }
    void request()
      .then((value) => {
        if (!alive) {
          revokeObjectUrl(value.url);
          return;
        }
        const expiresAtMs = Date.parse(value.expiresAt);
        if (
          typeof value.url !== "string" ||
          value.mediaId !== media.mediaId ||
          value.assetSha256 !== media.assetSha256 ||
          (value.youtube !== undefined && (!isQuestionMediaVideo(media) || !isYouTubeMediaDescriptor(value.youtube) || value.url !== youtubeEmbedUrl(value.youtube))) ||
          (value.youtube === undefined && !value.url.startsWith('blob:')) ||
          (preserveVideo && youtube && (value.youtube === undefined || value.url !== activeUrl.current)) ||
          !Number.isFinite(expiresAtMs) ||
          expiresAtMs <= Date.now()
        ) {
          failAndClear();
          return;
        }
        receivedUrl = value.url;
        if (value.youtube !== undefined) {
          if (youtubeExpiryTimer.current !== undefined) window.clearTimeout(youtubeExpiryTimer.current);
          youtubeExpiryTimer.current = window.setTimeout(failAndClear, expiresAtMs - Date.now());
        }
        if (preserveVideo) revokeObjectUrl(value.url);
        else {
          revokeObjectUrl(activeUrl.current);
          activeBinding.current = binding;
          activeUrl.current = value.url;
          setYoutube(value.youtube !== undefined);
          setUrl(value.url);
        }
        refreshTimer = window.setTimeout(
          () => setRefresh((current) => current + 1),
          Math.max(0, expiresAtMs - Date.now() - 1_000),
        );
      })
      .catch(() => {
        if (alive && !preserveVideo) failAndClear();
      });
    return () => {
      alive = false;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      if (receivedUrl && receivedUrl !== activeUrl.current)
        revokeObjectUrl(receivedUrl);
    };
  }, [binding, media.contentType, media.type, refresh, request]);
  if (failed)
    return (
      <section
        className="question-media"
        aria-live="polite"
        data-testid="question-media-error"
      >
        <p>تعذر تحميل وسائط السؤال.</p>
        <button
          className="button button--quiet"
          onClick={() => setRefresh((value) => value + 1)}
          type="button"
        >
          أعد المحاولة
        </button>
      </section>
    );
  return (
    <figure
      className={`question-media${concealed ? " question-media--concealed" : ""}`}
      aria-busy={!url}
      data-testid="question-media"
    >
      {url && youtube ? (
        <iframe src={url} title={media.altAr} allow="encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      ) : url && isQuestionMediaVideo(media) ? (
        <video autoPlay controls muted onError={() => setFailed(true)} playsInline src={url} />
      ) : url ? (
        <img alt={media.altAr} onError={() => setFailed(true)} src={url} />
      ) : (
        <p aria-live="polite">جارٍ تحميل وسائط السؤال…</p>
      )}
    </figure>
  );
}
const categoryCoverageMessage = "الفئات المختارة لا تكفي لتعبئة اللوح. أضيفوا فئة أو فئتين ثم حاولوا.";
const categoryRequiredMessage = "اختاروا فئة واحدة على الأقل.";
const categoryCoverageErrors = new Set([
  "CATEGORY_GAME_COMBINATION_INVALID",
  "QUESTION_SCOPE_INSUFFICIENT_COVERAGE",
  "SELECTED_SCOPE_NOT_PLAYABLE",
]);
export const readableError = (error: unknown) => {
  const message = roomErrorCode(error);
  if(/AUTHENTICATION|ID_TOKEN|VERIFIED_ACCOUNT/.test(message))return 'سجّل الدخول بحساب المضيف المحلي ثم أعد المحاولة.';
  if(/IDEMPOTENCY|REQUEST_KEY/.test(message))return 'طلب إنشاء الغرفة محفوظ بإعدادات مختلفة. استعد الطلب الأصلي قبل إنشاء مباراة أخرى.';
  if(/ORIGIN|LOCAL_ONLY/.test(message))return 'افتح التطبيق من عنوانه المحلي على هذا الكمبيوتر.';
  if(/^(SEAT_REMOVED|UNAUTHORIZED|NOT_MEMBER)$/.test(message))return 'لم تعد ضمن هذه الغرفة؛ ربما أزالك المضيف. ادخل من جديد باسمك.';
  if(message==='ROOM_NOT_FOUND')return 'لم نجد هذه الغرفة. تحقق من الرمز أو اطلب رابطاً جديداً من المضيف.';
  if(message==='NO_ROOM_SESSION')return 'ادخل باسمك أو سجّل الدخول بحساب المضيف.';
  if(message==='MATCH_COMPLETE')return 'انتهت هذه المباراة';
  if(message==='DUPLICATE_DISPLAY_NAME')return 'في لاعب بهذا الاسم. اختاروا اسماً آخر.';
  if(message==='INVALID_DISPLAY_NAME')return JOIN_NAME_MESSAGE;
  if (message === "STALE_REVISION")
    return "تغيّرت الغرفة للتو. راجع الحالة الحالية ثم حاول مرة أخرى.";
  if (
    message === "PROJECTION_UNAVAILABLE" ||
    message === "CAPABILITY_UNAVAILABLE"
  )
    return "تعذر التحقق من جلسة الغرفة. أعد فتح الرابط ثم حاول مرة أخرى.";
  if (
    categoryCoverageErrors.has(message) ||
    /(?:Insufficient 16 visible \+ 9 surprise letter coverage|Pinned release has insufficient 16 visible \+ 9 surprise coverage)/.test(
      message,
    )
  )
    return categoryCoverageMessage;
  if (message === "NAVIGATION_PRIVATE_GUIDE_REQUIRED")
    return "يحتاج «وجّه صاحبك» إلى لاعب موثّق في فريق الفرصة يحمل هاتف الدليل. انقل الهاتف إلى هذا الفريق قبل اختيار الخانة.";
  if (message === "ACTIVE_RELEASE_CHANGED")
    return "تغيّرت الحزمة المعتمدة. حدّث الإعدادات للتحقق من الفهرس الجديد.";
  return /[\u0600-\u06ff]/.test(message) ? message : 'تعذر إتمام العملية. حدّث حالة الغرفة وتأكد من تشغيل الخدمات المحلية ثم أعد المحاولة.';
};
type LocalIntentResponse = {
  projection?: ProjectionEnvelope<ViewProjection>;
  error?: string;
  stale?: boolean;
};
/** A local stale response is HTTP-successful but not an accepted user action. */
export function applyLocalIntentResponse(
  result: LocalIntentResponse,
  setProjection: (projection: ProjectionEnvelope<ViewProjection>) => void,
) {
  if (result.projection) setProjection(result.projection);
  if (result.stale) throw new Error("STALE_REVISION");
}

const previewLetters = [
  "أ",
  "ب",
  "ت",
  "ث",
  "ج",
  "ح",
  "خ",
  "د",
  "ذ",
  "ر",
  "ز",
  "س",
  "ش",
  "ص",
  "ض",
  "ط",
];
/** Stable, rule-generated board while a room projection is still loading. */
export const previewBoardCells: BoardCell[] = generateBoard(
  0x4855524f,
  previewLetters,
).cells;
export const isReadOnlyFixtureRoom = (
  runtimeKind: "fixture" | "firebase" | "local" | "pg",
  roomId?: string,
) => runtimeKind === "fixture" && roomId === "fixture-room";
function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} | الميدان`;
  }, [title]);
}
const teamName = (name?: string) =>
  name?.trim().startsWith("فريق")
    ? name.trim()
    : `فريق ${name?.trim() || "غير محدد"}`;
export const canDispatchLobbyStart = (state: string, canStart?: boolean) =>
  state === "LOBBY" && canStart === true;
const teamManagementStates = new Set([
  "LOBBY",
  "ROUND_SETUP",
  "CELL_SELECTION",
  "QUESTION_FAILED",
  "ROUND_COMPLETE",
]);
export const canManageTeamsInState = (state: string) =>
  teamManagementStates.has(state);

export { createGameIntentId };

export function normalizedJoinOrigin(value: string | undefined) {
  if (!value?.trim()) return undefined;
  try {
    const origin = new URL(value.trim());
    const hostname = origin.hostname.toLowerCase().replace(/\.+$/, "");
    const ipv6 = hostname.replace(/^\[|\]$/g, "");
    const mappedIpv4 = ipv6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    const mappedIpv4Value = mappedIpv4
      ? Number.parseInt(mappedIpv4[1], 16) * 0x1_0000 +
        Number.parseInt(mappedIpv4[2], 16)
      : undefined;
    const loopback =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      ipv6 === "::1" ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname) ||
      hostname === "0.0.0.0" ||
      ipv6 === "::" ||
      (mappedIpv4Value !== undefined &&
        mappedIpv4Value >= 0x7f00_0000 &&
        mappedIpv4Value <= 0x7fff_ffff);
    if (
      (origin.protocol !== "http:" && origin.protocol !== "https:") ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      loopback
    )
      return undefined;
    return origin.origin;
  } catch {
    return undefined;
  }
}

export function playerJoinUrl(origin: string | undefined, roomCode: string) {
  const safeOrigin = normalizedJoinOrigin(origin);
  if (!safeOrigin || !roomCode) return undefined;
  const url = new URL("/", safeOrigin);
  url.searchParams.set("room", roomCode);
  return url.toString();
}

export function currentRoomDestination(
  roomCode: string | undefined,
  role: "host" | "player" | "audience" | undefined,
) {
  if (!roomCode || !role) return undefined;
  const surface =
    role === "host" ? "host" : role === "player" ? "play" : "display";
  return `/room/${encodeURIComponent(roomCode)}/${surface}`;
}

export function resultRouteState(
  roomCode: string | undefined,
  role: "host" | "player" | "audience" | undefined,
  state: string,
) {
  const isFinal = state === "MATCH_COMPLETE";
  return {
    isFinal,
    returnTo: isFinal ? undefined : currentRoomDestination(roomCode, role),
  };
}

function sameSettingsNewMatchHref(settings?: SafeProjection["room"]["matchSettings"]) {
  if (!settings) return "/host/new";
  return `/host/new?${setupQueryString({
    categories: settings.categories, demo: settings.demo, gameKind: settings.gameKind ?? "huroof",
    horizontal: settings.teams.horizontal, mode: settings.mode, opponentSeconds: settings.opponentSeconds,
    questionSeconds: settings.questionSeconds, vertical: settings.teams.vertical,
  })}`;
}

export function activeLobbyDestination(
  roomCode: string | undefined,
  surface: "lobby" | "host" | "play" | "display" | "results",
  role: "host" | "player" | "audience" | undefined,
  state: string | undefined,
) {
  if (!roomCode || surface !== "lobby" || !state || state === "LOBBY")
    return undefined;
  if (role === "host" || role === "player")
    return currentRoomDestination(roomCode, role);
  return undefined;
}

export { AppHeader };
const AxisMark = ({ axis }: { axis: "horizontal" | "vertical" }) => (
  <span className={`axis-mark axis-mark--${axis}`}>
    <Icon kind={axis === "horizontal" ? "arrows-horizontal" : "arrows-vertical"} />{" "}
    {axis === "horizontal" ? "الأحمر" : "الأخضر"}
  </span>
);
const defaultCategoryCover = "/assets/categories/320/category-006.webp";
const maximumSelectedCategories = 10;
const setupGameKindCardLabels = {
  huroof: "حروف",
  categories: "مجموعات",
} as const;
const setupGameKindCardDescriptions = {
  huroof: "إجابات تبدأ بحرف الخلية",
  categories: "أسئلة من الفئات التي تختارها",
} as const;

const setupGameKindImages = {
  huroof: "/assets/game-types/huroof.webp",
  categories: "/assets/game-types/categories.webp",
} as const;

export function HostNewRoute() {
  useDocumentTitle("إنشاء مباراة");
  const navigate = useNavigate();
  const staticPreview = isStaticPreviewBuild();
  const location = useLocation();
  const expectsLocalInventory = !staticPreview && gameRuntime.kind === "local";
  const {user} = useFirebaseAuth();
  const currentOwner = useRef(user?.uid);currentOwner.current=user?.uid;
  const creationLifecycle=useRef(new AbortController());
  useEffect(()=>{const controller=new AbortController();creationLifecycle.current=controller;return()=>controller.abort();},[]);
  const localPending = useRef<{uid:string;request:CreateRoomRequest}|null>(null);
  const [recoveringCreation,setRecoveringCreation] = useState(false);
  const [creationBlocked,setCreationBlocked]=useState(false);
  useEffect(()=>{localPending.current=null;setRecoveringCreation(false);setCreationBlocked(false);if(!isAlmaidanLocalDevelopment||!user)return;try{const raw=sessionStorage.getItem(localCreationKey(user.uid));if(raw){localPending.current=parseLocalCreationPending(raw,user.uid);setRecoveringCreation(true);}}catch{setCreationBlocked(true);setError('تعذر قراءة طلب إنشاء الغرفة المحفوظ. لا تنشئ طلباً جديداً قبل استعادة الطلب الأصلي.');}},[user?.uid]);
  const querySeed = useRef(
    parseSetupQuery(new URLSearchParams(location.search), !staticPreview && (isAlmaidanLocalDevelopment || gameRuntime.kind === "firebase")),
  );
  const [form, setForm] = useState({
    demo: querySeed.current.demo,
    gameKind: querySeed.current.gameKind,
    mode: querySeed.current.mode,
    horizontal: querySeed.current.horizontal,
    vertical: querySeed.current.vertical,
    questionSeconds: querySeed.current.questionSeconds,
    opponentSeconds: querySeed.current.opponentSeconds,
    categories: querySeed.current.categories,
    challengeEnabled: false,
    labelledColours: false,
    mapPresentation: "ordinary" as "ordinary" | "interactive",
  });
  const [error, setError] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [busy, setBusy] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [categoryTopic, setCategoryTopic] = useState<CategoryTopicId | "all">(
    "all",
  );
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [unavailableCovers, setUnavailableCovers] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectionLimitMessage, setSelectionLimitMessage] = useState("");
  const [localQuestionInventory, setLocalQuestionInventory] =
    useState<LocalQuestionInventory | undefined>(() =>
      expectsLocalInventory ? (location.state as { questionInventory?: LocalQuestionInventory } | null)?.questionInventory : undefined,
    );
  const [inventoryLoading, setInventoryLoading] = useState(expectsLocalInventory && !localQuestionInventory);
  const [localQuestionInventoryError, setLocalQuestionInventoryError] =
    useState("");
  const [inventoryAttempt, setInventoryAttempt] = useState(0);
  const [approvedReleaseCatalog, setApprovedReleaseCatalog] = useState<ApprovedReleaseCatalog>();
  const [approvedReleaseCatalogError, setApprovedReleaseCatalogError] = useState("");
  const [approvedReleaseCatalogAttempt, setApprovedReleaseCatalogAttempt] = useState(0);
  const [localChallengeAvailability, setLocalChallengeAvailability] = useState<ChallengeMechanic[]>();
  const firebaseRuntime = gameRuntime.kind === "firebase";
  const modeControls = useRef<Array<HTMLButtonElement | null>>([]);
  const kindControls = useRef<Array<HTMLButtonElement | null>>([]);
  const categoryFilterControl = useRef<HTMLInputElement | null>(null);
  const categorySection = useRef<HTMLElement>(null);
  const removalControls = useRef<Record<string, HTMLButtonElement | null>>({});
  const [removalFocusTarget, setRemovalFocusTarget] = useState<string>();
  useEffect(() => {
    if (!expectsLocalInventory || localQuestionInventory) return;
    let active = true;
    void fetchLocalQuestionInventory()
      .then((inventory) => {
        if (!active) return;
        if (!inventory && isAlmaidanLocalDevelopment) throw new Error("فهرس الفئات غير متاح حالياً.");
        setLocalQuestionInventory(inventory);
        setLocalQuestionInventoryError("");
        setInventoryLoading(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setLocalQuestionInventoryError(
          reason instanceof Error ? reason.message : "تعذر تحميل فهرس أسئلة التجربة المحلية.",
        );
        setInventoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [expectsLocalInventory, inventoryAttempt, localQuestionInventory]);
  useEffect(() => {
    if (staticPreview || !firebaseRuntime) return;
    let active = true;
    void (gameRuntime.getApprovedReleaseCatalog?.() ?? Promise.reject(new Error("APPROVED_RELEASE_CATALOG_UNAVAILABLE")))
      .then((catalog) => {
        if (!active) return;
        setApprovedReleaseCatalog(catalog);
        setApprovedReleaseCatalogError("");
      })
      .catch(() => {
        if (!active) return;
        setApprovedReleaseCatalog(undefined);
        setApprovedReleaseCatalogError("لا توجد حزمة أسئلة معتمدة ونشطة لإنشاء غرفة مباشرة. راجع النشر أو جرّب لاحقاً.");
      });
    return () => { active = false; };
  }, [approvedReleaseCatalogAttempt, firebaseRuntime, staticPreview]);
  useEffect(() => {
    if (staticPreview || gameRuntime.kind !== "local") return;
    let active = true;
    void (gameRuntime.getChallengeAvailability?.() ?? Promise.reject(new Error("CHALLENGE_AVAILABILITY_UNAVAILABLE")))
      .then((availability) => { if (active) setLocalChallengeAvailability(availability.enabledMechanics); })
      .catch(() => { if (active) setLocalChallengeAvailability([]); });
    return () => { active = false; };
  }, [staticPreview]);
  const activeQuestionInventory = localQuestionInventory ?? (staticPreview ? staticPreviewQuestionInventory : undefined);
  const localCategoryById = useMemo(
    () =>
      new Map(
        activeQuestionInventory?.categories.map((category) => [
          category.id,
          category,
        ]) ?? [],
      ),
    [activeQuestionInventory],
  );
  const enabledChallengeKinds = useMemo(() => firebaseRuntime
    ? approvedReleaseCatalog?.challengeAvailability?.enabledMechanics ?? []
    : localChallengeAvailability ?? [], [approvedReleaseCatalog, firebaseRuntime, localChallengeAvailability]);
  const categorySelectionAllowed = useCallback((id: string) => {
    if (firebaseRuntime)
      return approvedCategoryPlayable(
        approvedReleaseCatalog?.categories.find((category) => category.id === id),
        form.gameKind,
        enabledChallengeKinds,
      );
    if (!activeQuestionInventory) return true;
    return localCategoryPlayable(
      localCategoryById.get(id),
      form.gameKind,
      activeQuestionInventory.huroofAvailable,
    );
  }, [activeQuestionInventory, approvedReleaseCatalog, enabledChallengeKinds, firebaseRuntime, form.gameKind, localCategoryById]);
  const categoryCatalogue = useMemo(() => {
    if (inventoryLoading || localQuestionInventoryError) return [];
    if (firebaseRuntime)
      return approvedReleaseCatalog ? catalogCategoryCovers(approvedReleaseCatalog.categories) : [];
    const inventory = localQuestionInventory ?? (staticPreview ? staticPreviewQuestionInventory : undefined);
    return inventory ? inventoryCategoryCovers(inventory) : legacyAvailableCategoryCatalog;
  }, [approvedReleaseCatalog, firebaseRuntime, inventoryLoading, localQuestionInventory, localQuestionInventoryError, staticPreview]);
  const availableCategoryCatalog = useMemo(
    () => categoryCatalogue.filter((category) => categorySelectionAllowed(category.id)),
    [categoryCatalogue, categorySelectionAllowed],
  );
  const canRevealUnavailable = Boolean(localQuestionInventory || approvedReleaseCatalog);
  const unavailableCategories = useMemo(() => canRevealUnavailable ? filterCategories(
    categoryCatalogue.filter((category) => !categorySelectionAllowed(category.id)),
    { query: categoryQuery, selectedIds: [], selectedOnly: false, topicId: categoryTopic },
  ) : [], [canRevealUnavailable, categoryCatalogue, categoryQuery, categorySelectionAllowed, categoryTopic]);
  const firebaseSelectedModeUnavailable = Boolean(
    firebaseRuntime && approvedReleaseCatalog && !approvedReleaseCatalog.boardCapabilities[form.gameKind],
  );
  const firebaseSelectedModeMessage = "الأسئلة المعتمدة الحالية لا تكفي لهذا النمط. اختر نمطاً متاحاً أو حدّث الحزمة.";
  useEffect(() => {
    if (!activeQuestionInventory && (!firebaseRuntime || !approvedReleaseCatalog)) return;
    setForm((current) => {
      const categories = current.categories.filter((id) => categorySelectionAllowed(id));
      return categories.length === current.categories.length
        ? current
        : { ...current, categories };
    });
  }, [activeQuestionInventory, approvedReleaseCatalog, categorySelectionAllowed, firebaseRuntime]);
  const availableCategoryTopics = useMemo(
    () =>
      categoryTopics.flatMap((topic) => {
        const count = availableCategoryCatalog.filter((category) =>
          categoryTopicIdForCategory(category) === topic.id,
        ).length;
        return count ? [{ topic, count }] : [];
      }),
    [availableCategoryCatalog],
  );
  const visibleCategories = useMemo(() => {
    return filterCategories(availableCategoryCatalog, {
      query: categoryQuery,
      selectedIds: [],
      selectedOnly: false,
      topicId: categoryTopic,
    });
  }, [
    availableCategoryCatalog,
    categoryQuery,
    categoryTopic,
  ]);
  const selectedCategories = useMemo(
    () =>
      form.categories.flatMap((id) => {
        const category = availableCategoryCatalog.find(
          (candidate) => candidate.id === id,
        );
        return category ? [category] : [];
      }),
    [availableCategoryCatalog, form.categories],
  );
  const selectedChallengeKinds = useMemo(() => [...new Set(selectedCategories.flatMap((selected) => {
    const category = firebaseRuntime
      ? approvedReleaseCatalog?.categories.find((item) => item.id === selected.id)
      : { id: selected.id };
    return categoryChallengeKinds(category);
  }))], [approvedReleaseCatalog, firebaseRuntime, selectedCategories]);
  const availableSelectedChallengeKinds = selectedChallengeKinds.filter((kind) => enabledChallengeKinds.includes(kind));
  const canEnableChallenges = form.gameKind === "categories" && availableSelectedChallengeKinds.length > 0;
  const challengeEnabled = canEnableChallenges && form.challengeEnabled;
  const mapPresentation = challengeEnabled && availableSelectedChallengeKinds.includes("qatar_map") ? form.mapPresentation : "ordinary";
  const minimumCategories = form.gameKind === "categories" ? 2 : 1;
  const coverageQuery = localQuestionInventory && selectedCategories.length >= minimumCategories ? new URLSearchParams([
    ["kind", form.gameKind],
    ...selectedCategories.map((category): [string, string] => ["category", category.id]),
    ...(challengeEnabled ? [["challenge", "1"], ["mapPresentation", mapPresentation]] as [string, string][] : []),
  ]).toString() : "";
  const [coverage, setCoverage] = useState<{ query: string; sufficient?: boolean }>();
  useEffect(() => {
    if (!coverageQuery) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/question-inventory/coverage?${coverageQuery}`, { signal: controller.signal, cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return undefined;
          const result = await response.json() as { sufficient?: unknown };
          return typeof result.sufficient === "boolean" ? result.sufficient : undefined;
        })
        .catch(() => undefined)
        .then((sufficient) => {
          if (!controller.signal.aborted) setCoverage({ query: coverageQuery, sufficient });
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [coverageQuery]);
  const scopeStatus = selectedCategories.length < minimumCategories
    ? "تحتاجون فئات أكثر"
    : coverageQuery && coverage?.query !== coverageQuery
      ? "جارٍ التحقق من الأسئلة…"
      : coverageQuery && coverage?.sufficient === undefined
        ? "تعذر التحقق من عدد الأسئلة"
        : coverageQuery && coverage?.sufficient === false
          ? "تحتاجون فئات أكثر"
          : coverageQuery ? <>أسئلة كافية <Icon kind="check" /></> : "";
  const update = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => setForm((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    const search = setupQueryString(form);
    if (location.search.slice(1) !== search)
      navigate(
        { pathname: location.pathname, search: `?${search}` },
        { replace: true },
      );
  }, [
    form.categories,
    form.demo,
    form.gameKind,
    form.horizontal,
    form.mode,
    form.opponentSeconds,
    form.questionSeconds,
    form.vertical,
    location.pathname,
    location.search,
    navigate,
  ]);
  const selectMode = (index: number, focus = false) => {
    const normalizedIndex =
      (index + matchModeOptions.length) % matchModeOptions.length;
    const mode = matchModeOptions[normalizedIndex].id;
    setForm((current) => mode === current.mode ? current : {
      ...current,
      ...(mode === "custom" ? {} : matchModeTiming(mode)),
      mode,
    });
    if (focus) modeControls.current[normalizedIndex]?.focus();
  };
  const handleModeKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const nextIndex =
      event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? index + 1
        : event.key === "ArrowRight" || event.key === "ArrowUp"
          ? index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? matchModeOptions.length - 1
              : undefined;
    if (nextIndex === undefined) return;
    event.preventDefault();
    selectMode(nextIndex, true);
  };
  const selectGameKind = (index: number, focus = false) => {
    const normalizedIndex =
      (index + setupGameKindOptions.length) % setupGameKindOptions.length;
    update("gameKind", setupGameKindOptions[normalizedIndex].id);
    setCategoryError("");
    if (focus) kindControls.current[normalizedIndex]?.focus();
  };
  const handleGameKindKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const nextIndex =
      event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? index + 1
        : event.key === "ArrowRight" || event.key === "ArrowUp"
          ? index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? setupGameKindOptions.length - 1
              : undefined;
    if (nextIndex === undefined) return;
    event.preventDefault();
    selectGameKind(nextIndex, true);
  };
  const toggleCategory = (id: string) => {
    if (!categorySelectionAllowed(id)) return;
    const isSelected = form.categories.includes(id);
    if (!isSelected && form.categories.length >= maximumSelectedCategories) {
      setSelectionLimitMessage(
        `يمكن اختيار ${maximumSelectedCategories} فئات كحد أقصى.`,
      );
      return;
    }
    setSelectionLimitMessage("");
    if (!isSelected) setCategoryError("");
    update(
      "categories",
      isSelected
        ? form.categories.filter((item) => item !== id)
        : [...form.categories, id],
    );
  };
  const pickRandomCategories = () => {
    const remaining = visibleCategories.filter((category) => !form.categories.includes(category.id));
    const recommended = localQuestionInventory?.recommendedHuroofCategoryIds?.slice(0, maximumSelectedCategories) ?? [];
    const canUseRecommended = form.gameKind === "huroof" && !form.categories.length &&
      recommended.length > 0 && recommended.every((id) => remaining.some((category) => category.id === id));
    const candidates = canUseRecommended
      ? remaining.filter((category) => !recommended.includes(category.id))
      : remaining;
    const chosen = canUseRecommended ? [...recommended] : [...form.categories];
    const count = Math.min(maximumSelectedCategories - chosen.length, Math.max(1, minimumCategories - chosen.length));
    for (let i = 0; i < count && candidates.length; i += 1) {
      const [category] = candidates.splice(Math.floor(Math.random() * candidates.length), 1);
      chosen.push(category.id);
    }
    if (chosen.length > form.categories.length) {
      setCategoryError("");
      setSelectionLimitMessage("");
      update("categories", chosen);
    }
  };
  const removeSelectedCategory = (id: string) => {
    const index = selectedCategories.findIndex(
      (category) => category.id === id,
    );
    const remaining = selectedCategories.filter(
      (category) => category.id !== id,
    );
    setRemovalFocusTarget(
      remaining[index]?.id ?? remaining[index - 1]?.id ?? "filter",
    );
    toggleCategory(id);
  };
  useEffect(() => {
    if (!removalFocusTarget) return;
    if (removalFocusTarget === "filter") categoryFilterControl.current?.focus();
    else removalControls.current[removalFocusTarget]?.focus();
    setRemovalFocusTarget(undefined);
  }, [removalFocusTarget, selectedCategories]);
  const resetCategoryFilters = () => {
    setCategoryQuery("");
    setCategoryTopic("all");
  };
  const categoryFiltersActive =
    categoryQuery.trim().length > 0 || categoryTopic !== "all";
  const showCategoryError = (message: string) => {
    setCategoryError(message);
    categorySection.current?.scrollIntoView?.({ block: "start" });
    categoryFilterControl.current?.focus({ preventScroll: true });
  };
  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy || creationBlocked || inventoryLoading || localQuestionInventoryError) return;
    setError("");
    setCategoryError("");
    if(isAlmaidanLocalDevelopment&&(!user||user.isAnonymous)){navigate(`/login?returnTo=${encodeURIComponent(location.pathname+`?${setupQueryString(form)}`)}`);return;}
    if (staticPreview) {
      setError(staticPreviewNotice);
      return;
    }
    if (firebaseRuntime && !approvedReleaseCatalog) {
      setError(approvedReleaseCatalogError || "جارٍ التحقق من الحزمة المعتمدة قبل إنشاء الغرفة.");
      return;
    }
    const releaseCatalog = approvedReleaseCatalog;
    if (firebaseRuntime && !releaseCatalog!.boardCapabilities[form.gameKind]) {
      setError("لا توجد تغطية معتمدة كافية لنوع اللوح المحدد. اختر نوعاً آخر أو انتظر نشر حزمة مكتملة.");
      return;
    }
    if (localQuestionInventory && !form.demo) {
      setError(
        "أسئلة قاعدة البيانات المحلية مسودات للتجربة فقط؛ فعّل وضع التجربة أو استخدم المصدر المعتمد.",
      );
      return;
    }
    if (
      localQuestionInventory &&
      form.gameKind === "huroof" &&
      !localQuestionInventory.huroofAvailable
    ) {
      setError(
        "لا توجد تغطية حروف كافية في مصدر التجربة المحلي لهذه المباراة.",
      );
      return;
    }
    if (!recoveringCreation && selectedCategories.length === 0 && (!firebaseRuntime || form.gameKind === "categories")) {
      showCategoryError(categoryRequiredMessage);
      return;
    }
    if (!recoveringCreation && form.gameKind === "categories" && selectedCategories.length < 2) {
      showCategoryError(categoryCoverageMessage);
      return;
    }
    setBusy(true);
    let attemptedEpoch:OwnerEpoch|null=null;
    let attemptedRaw:string|null=null;
    try {
      const request = {
        displayName: "المضيف",
        demo: firebaseRuntime ? releaseCatalog?.demoFixture === true : form.demo,
        ...(firebaseRuntime && releaseCatalog ? { expectedRelease: { releaseId: releaseCatalog.releaseId, releaseRootSha256: releaseCatalog.releaseRootSha256 } } : {}),
        gameKind: form.gameKind,
        mode: form.mode,
        modality: "classic" as const,
        questionSeconds: form.questionSeconds,
        opponentSeconds: form.opponentSeconds,
        teams: { horizontal: form.horizontal, vertical: form.vertical },
        categories: (selectedCategories.length ? selectedCategories : releaseCatalog?.categories ?? []).map((category) => category.id),
        labelledColours: form.labelledColours,
        mapPresentation,
        ...(challengeEnabled ? { challenge: CLIENT_CHALLENGE_CAPABILITY } : {}),
      };
      const ownerUid=user?.uid;
      const epoch=isAlmaidanLocalDevelopment&&user?ownerEpoch(user.uid):null;
      attemptedEpoch=epoch;
      const signal=creationLifecycle.current.signal;
      let dispatched:CreateRoomRequest=request;
      let authority:{idToken:string;assertCurrent?:()=>void}|undefined;
      if(isAlmaidanLocalDevelopment&&user){
        const stored=sessionStorage.getItem(localCreationKey(user.uid));
        if(stored)localPending.current=parseLocalCreationPending(stored,user.uid);
        else if(localPending.current)throw new Error('LOCAL_PENDING_UNREADABLE');
        if(!localPending.current){const pending={uid:user.uid,request:{...request,requestKey:crypto.randomUUID()}};sessionStorage.setItem(localCreationKey(user.uid),JSON.stringify(pending));localPending.current=pending;}
        if(localPending.current.uid!==user.uid)throw new Error('AUTHENTICATION_REQUIRED');
        dispatched=localPending.current.request;attemptedRaw=sessionStorage.getItem(localCreationKey(user.uid));if(!attemptedRaw)throw new Error('LOCAL_PENDING_UNREADABLE');setRecoveringCreation(true);authority={idToken:await user.getIdToken(),assertCurrent:()=>assertOwnerEpoch(epoch!,signal)};
        if(currentOwner.current!==ownerUid)throw new Error('AUTHENTICATION_REQUIRED');
        assertOwnerEpoch(epoch!,signal);
      }
      const body =
        gameRuntime.kind === "fixture"
          ? await fetch("/api/rooms", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(request),
            }).then(async (response) => {
              if (!response.ok)
                throw new Error(
                  ((await response.json()) as { error?: string }).error ??
                    "تعذر إنشاء الغرفة.",
                );
              return response.json() as Promise<{
                roomId: string;
                roomCode: string;
                token: string;
              }>;
            })
          : await gameRuntime.createRoom(dispatched,authority);
      if (!body.roomId || !body.roomCode) throw new Error("تعذر إنشاء الغرفة.");
      if(isAlmaidanLocalDevelopment&&currentOwner.current!==ownerUid)throw new Error('AUTHENTICATION_REQUIRED');
      if(epoch)assertOwnerEpoch(epoch,signal);
      if(isAlmaidanLocalDevelopment&&ownerUid){const stored=sessionStorage.getItem(localCreationKey(ownerUid));if(!stored||JSON.stringify(parseLocalCreationPending(stored,ownerUid).request)!==JSON.stringify(dispatched))throw new Error('LOCAL_PENDING_UNREADABLE');}
      saveCapability(body.roomId, { token: body.token ?? "", role: "host" });
      sessionStorage.setItem(`huroof:code:${body.roomCode}`, body.roomId);
      if(isAlmaidanLocalDevelopment&&ownerUid){sessionStorage.removeItem(localCreationKey(ownerUid));localPending.current=null;setRecoveringCreation(false);}
      navigate(`/room/${body.roomCode}/lobby`);
    } catch (reason) {
      if(reason instanceof Error&&reason.message==='LOCAL_PENDING_UNREADABLE')setCreationBlocked(true);
      if(reason instanceof LocalRoomCreationFailure&&reason.definitive&&attemptedEpoch&&isOwnerEpoch(attemptedEpoch)&&!creationLifecycle.current.signal.aborted){try{if(!attemptedRaw||sessionStorage.getItem(localCreationKey(attemptedEpoch.uid))!==attemptedRaw)throw Error('LOCAL_PENDING_UNREADABLE');sessionStorage.removeItem(localCreationKey(attemptedEpoch.uid));localPending.current=null;setRecoveringCreation(false);}catch{setCreationBlocked(true);}}
      const message = readableError(reason);
      if (message === categoryCoverageMessage) showCategoryError(message);
      else setError(message);
      if (
        firebaseRuntime &&
        reason instanceof Error &&
        reason.message.replace(/^Error:\s*/, "") === "ACTIVE_RELEASE_CHANGED"
      )
        setApprovedReleaseCatalogAttempt((attempt) => attempt + 1);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main data-page-layout="wide"
      className="maydan-app maydan-public-page maydan-host-page" data-page-kind="setup"
      id="main-content"
      tabIndex={-1}
    >
      <AppHeader />
      <section
        className="maydan-host-setup"
        aria-labelledby="setup-title"
        data-runtime={gameRuntime.kind}
        data-catalogue-source={activeQuestionInventory?.source ?? 'unavailable'}
      >
        <header className="game-artwork-heading">
          <div>
            <p className="eyebrow">إعداد مباراة الخلية</p>
            <h1 id="setup-title">جهّزوا اللوح. وابدأوا التحدّي.</h1>
            {staticPreview ? <p className="form-message" role="status">{staticPreviewNotice}</p> : null}
            {recoveringCreation?<p className="form-message" role="status">يوجد طلب إنشاء محفوظ. زر الإنشاء يستعيد الغرفة نفسها بإعداداتها الأصلية؛ لن ينشئ غرفة ثانية.</p>:null}
          </div>
          <GameArtwork game="huroof" />
        </header>
        <form className="setup-form" id="match-setup-form" onSubmit={create}>
          <div className="setup-fields">
          <section className="game-kind-fields">
            <h2>نوع اللوح</h2>
            <div
              className="setup-kind-selector"
              role="radiogroup"
              aria-label="نوع اللوح"
            >
              {setupGameKindOptions.map((kind, index) => (
                <button
                  aria-checked={form.gameKind === kind.id}
                  aria-label={kind.labelAr}
                  aria-describedby={`setup-kind-${kind.id}-description`}
                  className={form.gameKind === kind.id ? "is-selected" : ""}
                  key={kind.id}
                  onClick={() => selectGameKind(index)}
                  onKeyDown={(event) => handleGameKindKeyDown(event, index)}
                  ref={(element) => {
                    kindControls.current[index] = element;
                  }}
                  role="radio"
                  tabIndex={form.gameKind === kind.id ? 0 : -1}
                  type="button"
                >
                  <img alt="" className="setup-kind-selector__image" decoding="async" height={192} src={setupGameKindImages[kind.id]} width={192} />
                  <span className="setup-kind-selector__copy">
                    <strong>{setupGameKindCardLabels[kind.id]}</strong>
                    <small id={`setup-kind-${kind.id}-description`}>
                      {setupGameKindCardDescriptions[kind.id]}
                    </small>
                  </span>
                  <span className="setup-kind-selector__check"><Icon kind="check" /></span>
                </button>
              ))}
            </div>
          </section>
          <section className="match-mode-fields">
            <h2>المباراة</h2>
            <div
              className="segmented"
              role="radiogroup"
              aria-label="نمط المباراة"
            >
              {matchModeOptions.map((mode, index) => (
                <button
                  aria-checked={form.mode === mode.id}
                  className={form.mode === mode.id ? "is-selected" : ""}
                  key={mode.id}
                  onClick={() => selectMode(index)}
                  onKeyDown={(event) => handleModeKeyDown(event, index)}
                  ref={(element) => {
                    modeControls.current[index] = element;
                  }}
                  role="radio"
                  tabIndex={form.mode === mode.id ? 0 : -1}
                  type="button"
                >
                  {mode.labelAr}
                </button>
              ))}
            </div>
            <p className="field-note match-mode-description">
              <span>{
                matchModeOptions.find((mode) => mode.id === form.mode)
                  ?.descriptionAr
              }</span>{" "}<span>تنتهي المباراة بفوز فريق بجولتين متتاليتين أو بثلاث جولات إجمالاً</span>
            </p>
          </section>
          <details className="setup-advanced">
            <summary>إعدادات إضافية</summary>
          <section className="timing-fields">
            <h2>التوقيت</h2>
            <label className="timing-fields__control">
              <span>وقت السؤال</span>
              <input
                min="10"
                max="60"
                type="number"
                value={form.questionSeconds}
                onChange={(event) =>
                  update("questionSeconds", Number(event.target.value))
                }
              />
            </label>
            <label className="timing-fields__control">
              <span>فرصة الخصم</span>
              <input
                min="10"
                max="60"
                type="number"
                value={form.opponentSeconds}
                onChange={(event) =>
                  update("opponentSeconds", Number(event.target.value))
                }
              />
            </label>
          </section>
          {canEnableChallenges && <section className="challenge-capability-fields" aria-labelledby="challenge-capability-title">
            <h2 id="challenge-capability-title">تحدّيات تفاعلية</h2>
            <label>
              <input checked={challengeEnabled} onChange={(event) => update("challengeEnabled", event.target.checked)} type="checkbox" />
              أضيفوا تحدّيات تفاعلية للفئات المختارة
            </label>
            <label>
              <input checked={form.labelledColours} disabled={!challengeEnabled} onChange={(event) => update("labelledColours", event.target.checked)} type="checkbox" />
              أظهروا أسماء الألوان في تحدّي «لون الصورة»
            </label>
            {availableSelectedChallengeKinds.includes("qatar_map") ? <fieldset disabled={!challengeEnabled}>
              <legend>عرض «لوكيشن قطر»</legend>
              <label>
                <input checked={form.mapPresentation === "ordinary"} name="map-presentation" onChange={() => update("mapPresentation", "ordinary")} type="radio" />
                الأسئلة الأصلية المعتادة
              </label>
              <label>
                <input checked={form.mapPresentation === "interactive"} name="map-presentation" onChange={() => update("mapPresentation", "interactive")} type="radio" />
                التحدّي التفاعلي
              </label>
            </fieldset> : null}
            <p className="field-note">المتاح: {availableSelectedChallengeKinds.map((kind) => ({ missing_tile: "الجزء المفقود", qatar_map: "لوكيشن قطر", navigation: "وجّه صاحبك", memory: "لون الصورة", word_search: "صيد المختفي" })[kind]).join("، ")}.</p>
            {availableSelectedChallengeKinds.includes("navigation") && <p className="field-note">يحتاج «وجّه صاحبك» إلى هاتف للدليل. يقدر المضيف يدخل حركة اللاعب إذا كان يلعب بدون جوال.</p>}
          </section>}
          </details>
          <section className="setup-categories" ref={categorySection} aria-labelledby="setup-categories-title" aria-busy={inventoryLoading}>
            <div className="setup-categories__heading">
              <h2 id="setup-categories-title">الفئات</h2>
              {!inventoryLoading && !localQuestionInventoryError && <p className="field-note">
                <bdi>{selectedCategories.length} مختارة</bdi> <span role="status">{scopeStatus}</span>
              </p>}
            </div>
            {categoryError && <p className="form-message" id="setup-category-error" role="alert">{categoryError}</p>}
            {form.gameKind === "categories" && selectedCategories.length === 1 &&
              <p className="field-note">اختاروا فئة ثانية على الأقل لتكتمل اللوحة.</p>}
            {staticPreview ? (
              <p className="field-note" role="status">
                يعرض هذا الفهرس محتوى معاينة الواجهة فقط، ولا يثبت توفره للعب المنشور.
              </p>
            ) : null}
            {inventoryLoading ? (
              <div aria-hidden="true" className="category-grid setup-categories__skeletons">
                {Array.from({ length: 4 }, (_, index) => <span className="setup-categories__skeleton" key={index} />)}
              </div>
            ) : localQuestionInventoryError ? (
              <div role="alert">
                <p className="field-note">{localQuestionInventoryError}</p>
                <button
                  className="button"
                  type="button"
                  onClick={() => {
                    setLocalQuestionInventoryError("");
                    setInventoryLoading(true);
                    setInventoryAttempt((attempt) => attempt + 1);
                  }}
                >
                  إعادة المحاولة
                </button>
              </div>
            ) : <>
            <div className="category-filter" role="search">
              <label>
                <span>تصفية الفئات</span>
                <input
                  aria-label="تصفية الفئات"
                  aria-describedby={categoryError ? "setup-category-error" : undefined}
                  onChange={(event) => setCategoryQuery(event.target.value)}
                  placeholder="ابحث باسم الفئة"
                  ref={categoryFilterControl}
                  type="search"
                  value={categoryQuery}
                />
              </label>
              <button
                className="button button--secondary setup-categories__random"
                disabled={form.categories.length >= maximumSelectedCategories || !visibleCategories.some((category) => !form.categories.includes(category.id))}
                onClick={pickRandomCategories}
                type="button"
              >
                اختاروا لنا عشوائياً
              </button>
              <div className="category-filter__controls">
                <div aria-label="الموضوع" className="category-topic-picker" role="group">
                  <span className="category-topic-picker__label">الموضوع</span>
                  <div className="category-topic-picker__list">
                    <button
                      aria-pressed={categoryTopic === "all"}
                      className={`category-topic-picker__button category-topic-picker__button--all${categoryTopic === "all" ? " is-selected" : ""}`}
                      onClick={() => setCategoryTopic("all")}
                      type="button"
                    >
                      <span aria-hidden="true" className="category-topic-picker__all-mark">الكل</span>
                      <span>كل الموضوعات</span>
                      <small>{availableCategoryCatalog.length}</small>
                    </button>
                    {availableCategoryTopics.map(({ topic, count }) => (
                      <button
                        aria-pressed={categoryTopic === topic.id}
                        className={`category-topic-picker__button${categoryTopic === topic.id ? " is-selected" : ""}`}
                        key={topic.id}
                        onClick={() => setCategoryTopic(topic.id)}
                        type="button"
                      >
                        <span
                          aria-hidden="true"
                          className={`category-topic-picker__image category-topic-picker__image--${topic.id}`}
                        />
                        <span>{topic.labelAr}</span>
                        <small>{count}</small>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="category-filter__meta">
                <small aria-live="polite">
                  {visibleCategories.length} من{" "}
                  {availableCategoryCatalog.length} فئة
                </small>
                <button
                  className="category-filter__reset"
                  disabled={!categoryFiltersActive}
                  onClick={resetCategoryFilters}
                  type="button"
                >
                  إعادة ضبط التصفية
                </button>
              </div>
            </div>
            <div className="category-grid">
              {visibleCategories.map((category) => {
                  const isFallbackCover = unavailableCovers.has(category.id);
                  return (
                    <button
                      aria-label={`${category.displayNameAr}${form.categories.includes(category.id) ? " — محددة" : " — أضف إلى الاختيار"}`}
                      aria-pressed={form.categories.includes(category.id)}
                      className={`category-choice ${form.categories.includes(category.id) ? "is-selected" : ""}`}
                      key={category.id}
                      onClick={() => toggleCategory(category.id)}
                      type="button"
                    >
                      <img
                        decoding="async"
                        loading="lazy"
                        alt={
                          isFallbackCover
                            ? `صورة افتراضية لفئة ${category.displayNameAr}`
                            : category.cover.altAr
                        }
                        onError={() => {
                          if (!isFallbackCover)
                            setUnavailableCovers((current) =>
                              new Set(current).add(category.id),
                            );
                        }}
                        src={
                          isFallbackCover
                            ? defaultCategoryCover
                            : `/${category.cover.web320}`
                        }
                      />
                      <span className="category-choice__title">
                        {category.displayNameAr}
                      </span>
                      {form.categories.includes(category.id) && <span className="category-choice__check"><Icon kind="check" /></span>}
                    </button>
                  );
              })}
              {visibleCategories.length === 0 ? (
                <p className="category-filter__empty" role="status">
                  لا توجد فئات مطابقة. أعد ضبط التصفية لعرض كل الفئات.
                </p>
              ) : null}
            </div>
            {unavailableCategories.length > 0 && <div className="setup-categories__unavailable">
              <button aria-controls="setup-unavailable-categories" aria-expanded={showUnavailable}
                className="button button--quiet" onClick={() => setShowUnavailable((show) => !show)} type="button">
                {showUnavailable ? "أخفِ غير المتاحة" : `أظهر غير المتاحة (${unavailableCategories.length})`}
              </button>
              <div hidden={!showUnavailable} id="setup-unavailable-categories">
                {showUnavailable && <>
                  <p className="field-note">هالفئات ما فيها أسئلة كافية للوح اللي اخترتوه.</p>
                  <div className="category-grid">
                    {unavailableCategories.map((category) => <button aria-label={`${category.displayNameAr} — غير متاحة`}
                      className="category-choice" disabled key={category.id} type="button">
                      <img alt="" decoding="async" loading="lazy" src={`/${category.cover.web320}`} />
                      <span className="category-choice__title">{category.displayNameAr}</span>
                    </button>)}
                  </div>
                </>}
              </div>
            </div>}
            </>}
          </section>
          {selectedCategories.length > 0 ? (
            <aside
              className="selected-categories-bar"
              aria-label="الفئات المختارة"
            >
              <div className="selected-categories-bar__heading">
                <strong>الفئات المختارة</strong>
                <bdi
                  aria-label={`${selectedCategories.length} من ${maximumSelectedCategories} فئات`}
                  dir="ltr"
                >
                  {selectedCategories.length} / {maximumSelectedCategories}
                </bdi>
              </div>
              <ul className="selected-categories-bar__chips">
                {selectedCategories.map((category) => (
                  <li key={category.id}>
                    <button
                      aria-label={`إزالة ${category.displayNameAr}`}
                      onClick={() => removeSelectedCategory(category.id)}
                      ref={(element) => {
                        removalControls.current[category.id] = element;
                      }}
                      type="button"
                    >
                      <span className="selected-categories-bar__chip-label">
                        {category.displayNameAr}
                      </span>
                      <span
                        aria-hidden="true"
                        className="selected-categories-bar__chip-close"
                      >
                        ×
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p aria-live="polite">{selectionLimitMessage}</p>
            </aside>
          ) : null}
          {querySeed.current.notice && (
            <p className="form-message" data-testid="setup-query-notice">
              {querySeed.current.notice}
            </p>
          )}
          {firebaseRuntime ? (
            <p className="field-note" role="status">
              {approvedReleaseCatalog
                ? firebaseSelectedModeUnavailable
                  ? firebaseSelectedModeMessage
                  : approvedReleaseCatalog.demoFixture
                  ? "هذه حزمة تجريبية للمحاكي فقط."
                  : "سيُنشأ اللعب المباشر من الحزمة المعتمدة النشطة."
                : approvedReleaseCatalogError || "جارٍ التحقق من الحزمة المعتمدة…"}
              {approvedReleaseCatalogError ? (
                <button className="button button--quiet" onClick={() => setApprovedReleaseCatalogAttempt((attempt) => attempt + 1)} type="button">أعد المحاولة</button>
              ) : null}
            </p>
          ) : activeQuestionInventory?.source === 'local_saved_release' ? <p className="field-note">تُستخدم الأسئلة الأصلية المحفوظة على هذا الكمبيوتر. يمكن للمضيف التحكم بالفريقين أو دعوة اللاعبين برمز الغرفة.</p> : <label className="demo-control">
            <input
              checked={form.demo}
              onChange={(event) => update("demo", event.target.checked)}
              type="checkbox"
            />{" "}
            استخدم مسودات تجريبية صريحة؛ يمكن للمضيف تشغيل الفريقين دون لاعبين.
          </label>}
          </div>
        <aside className="setup-summary">
          <p className="eyebrow">ملخص مباشر</p>
          <dl>
            <div>
              <dt>نوع اللوح</dt>
              <dd>
                {
                  setupGameKindOptions.find((kind) => kind.id === form.gameKind)
                    ?.labelAr
                }
              </dd>
            </div>
            <div>
              <dt>قاعدة الفوز</dt>
              <dd>
                تنتهي المباراة بفوز فريق بجولتين متتاليتين أو بثلاث جولات
                إجمالاً
              </dd>
            </div>
            <div>
              <dt>الفئات المختارة</dt>
              <dd>
                {selectedCategories.length ? selectedCategories.map((category) => category.displayNameAr).join("، ") : "لم تُحدد فئة بعد"}
              </dd>
            </div>
            <div>
              <dt>التوقيت</dt>
              <dd>
                {form.questionSeconds}ث / {form.opponentSeconds}ث
              </dd>
            </div>
          </dl>
          <p className="field-note">
            ابدأ بلا لاعبين للتحكم بالفريقين، أو انضم بلاعبين من الفريقين
            واجعلهم جميعاً جاهزين.
          </p>
          <button
            className="button button--primary"
            data-testid="create-room"
            disabled={
              busy || creationBlocked || inventoryLoading || Boolean(localQuestionInventoryError) || staticPreview || (firebaseRuntime ? !approvedReleaseCatalog || !approvedReleaseCatalog.boardCapabilities[form.gameKind] : !form.demo)
            }
            title={staticPreview ? staticPreviewNotice : firebaseRuntime && !approvedReleaseCatalog ? approvedReleaseCatalogError || "جارٍ التحقق من الحزمة المعتمدة" : !form.demo ? "لا يوجد مخزون معتمد كافٍ" : undefined}
            type="submit"
          >
            {staticPreview ? "إنشاء الغرفة غير متاح في المعاينة" : inventoryLoading ? "جارٍ تحميل الفئات…" : busy ? "جارٍ الإنشاء…" : isAlmaidanLocalDevelopment || localQuestionInventory ? "إنشاء الغرفة" : firebaseRuntime ? "أنشئ الغرفة المباشرة" : "أنشئ الغرفة التجريبية"}
          </button>
          <p aria-live="polite" className="form-message">
            {error ||
              (firebaseRuntime && !approvedReleaseCatalog
                ? approvedReleaseCatalogError || "جارٍ التحقق من الحزمة المعتمدة…"
                : firebaseSelectedModeUnavailable
                  ? firebaseSelectedModeMessage
                : !firebaseRuntime && !form.demo
                ? "لا يوجد مخزون معتمد كافٍ لإنشاء مباراة عادية."
                : "")}
          </p>
        </aside>
        </form>
      </section>
    </main>
  );
}

function useRoom(
  code?: string,
  autoAudience = false,
  projectionRole?: "host" | "player" | "audience",
) {
  const pg = useContext(PgRuntimeContext);
  const { user, status } = useFirebaseAuth();
  const owner = !autoAudience && user && !user.isAnonymous ? user : null;
  const awaitingOwner = !autoAudience && status === "loading";
  const [envelope, setEnvelope] =
    useState<ProjectionEnvelope<ViewProjection> | null>(null);
  // Intents must bind the most recently delivered authoritative revision, not a
  // render-closure that can lag a Firestore server snapshot after reload.
  const envelopeRef = useRef<ProjectionEnvelope<ViewProjection> | null>(null);
  const projectionListeners = useRef(new Set<() => void>());
  const readyRetryScope = useRef<AbortSignal>(undefined);
  const installProjection = useCallback((next: ProjectionEnvelope<ViewProjection>) => {
    if ((envelopeRef.current?.revision ?? -1) > next.revision) return;
    envelopeRef.current = next;
    setEnvelope(next);
    for (const listener of projectionListeners.current) listener();
  }, []);
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "reconnecting" | "offline" | "stale"
  >("connecting");
  const [error, setError] = useState("");
  const [presence, setPresence] = useState<HostPresenceSnapshot | null>(null);
  const retry = useRef<number | undefined>(undefined);
  const presenceTimeout = useRef<number | undefined>(undefined);
  const presenceStop = useRef<(() => void) | undefined>(undefined);
  const latestPresenceServerTime = useRef(0);
  const expectedPresenceRefresh = useRef<string | undefined>(undefined);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  useLayoutEffect(() => {
    let locatorBackend: 'pg' | 'legacy' | 'enta';
    try { locatorBackend = parseRoomLocator(code).backend; } catch { setConnection('offline'); setError('INVALID_LOCATOR'); return; }
    if (locatorBackend === 'enta') { setConnection('offline'); setError('INVALID_LOCATOR'); return; }
    if (locatorBackend === 'pg') {
      if (!pg || !code) { setConnection('offline'); setError('PG_UNAVAILABLE'); return; }
      const view=autoAudience || projectionRole==='audience' ? 'audience' : 'member';
      envelopeRef.current=null; setEnvelope(null);
      let unbind=pg.bindRoute(code,view); let active=true; let unsubscribe:(()=>void)|undefined; let timer:ReturnType<typeof setTimeout>|undefined; let retryDelay=1000;
      const schedule=(rebind:boolean) => {
        if(!active || timer) return;
        timer=setTimeout(() => { timer=undefined; if(!active) return; if(rebind) { unsubscribe?.(); unsubscribe=undefined; unbind(); unbind=pg.bindRoute(code,view); } launch(); }, retryDelay);
        retryDelay=Math.min(15000,retryDelay*2);
      };
      const launch=() => {
        void pg.resumeRoom(code).then(() => {
          if(!active) return; const role=pg.currentRole(); if(!role || (projectionRole && role!==projectionRole)) throw new Error('ROLE_UNAVAILABLE');
          retryDelay=1000;
          unsubscribe=pg.subscribeProjection(code,role,'',(next) => {
            if(!active) return; envelopeRef.current=next as ProjectionEnvelope<ViewProjection>; setEnvelope(next as ProjectionEnvelope<ViewProjection>); setConnection('connected'); setError('');
          }, (reason) => {
            if(!active) return; envelopeRef.current=null; setEnvelope(null); setConnection('offline'); setError(readableError(reason));
            if(reason.message==='AUTH_CHANGED') schedule(true);
          });
        }).catch((reason) => { if(!active) return; envelopeRef.current=null; setEnvelope(null); setConnection('offline'); setError(readableError(reason)); if (!isTerminalRoomError(reason)) schedule(false); });
      };
      launch();
      return () => { active=false; if(timer) clearTimeout(timer); unsubscribe?.(); unbind(); envelopeRef.current=null; };
    }
    const retryScope = new AbortController();
    readyRetryScope.current = retryScope.signal;
    let alive = true;
    let terminal = false;
    let connecting: AbortController | undefined;
    let retryDelay = 1_000;
    const online = () => navigator.onLine !== false;
    const clearRetry = () => {
      if (retry.current !== undefined) {
        window.clearTimeout(retry.current);
        retry.current = undefined;
      }
    };
    const clearPresence = () => {
      presenceStop.current?.();
      presenceStop.current = undefined;
      if (presenceTimeout.current !== undefined)
        window.clearTimeout(presenceTimeout.current);
      presenceTimeout.current = undefined;
      latestPresenceServerTime.current = 0;
      expectedPresenceRefresh.current = undefined;
      setPresence(null);
    };
    const acceptPresence = (value: HostPresenceSnapshot) => {
      const serverTime = Date.parse(value.serverTime);
      if (
        expectedPresenceRefresh.current &&
        value.refreshId !== expectedPresenceRefresh.current
      )
        return;
      if (
        !Number.isFinite(serverTime) ||
        serverTime < latestPresenceServerTime.current
      )
        return;
      expectedPresenceRefresh.current = undefined;
      latestPresenceServerTime.current = serverTime;
      setPresence(value);
      if (presenceTimeout.current !== undefined)
        window.clearTimeout(presenceTimeout.current);
      presenceTimeout.current = window.setTimeout(
        () => setPresence(null),
        30_000,
      );
    };
    const closeSocket = () => {
      connecting?.abort();
      const socket = socketRef.current;
      socketRef.current = undefined;
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
      clearPresence();
    };
    const stop = (reason: unknown, invalidRoomId?: string) => {
      terminal = true;
      if (invalidRoomId) forgetRoomCapability(invalidRoomId, autoAudience);
      clearRetry();
      closeSocket();
      envelopeRef.current = null;
      setEnvelope(null);
      setConnection("offline");
      setError(readableError(reason));
    };
    const schedule = (connect: () => void) => {
      if (
        alive &&
        !terminal &&
        online() &&
        retry.current === undefined &&
        !socketRef.current &&
        !connecting
      ) {
        retry.current = window.setTimeout(() => {
          retry.current = undefined;
          connect();
        }, retryDelay);
        retryDelay = Math.min(15_000, retryDelay * 2);
      }
    };
    const connect = async () => {
      if (!alive || terminal) return;
      if (!online()) {
        setConnection("offline");
        return;
      }
      if (connecting || socketRef.current) return;
      const attempt = new AbortController();
      connecting = attempt;
      const { signal } = attempt;
      const timeout = window.setTimeout(() => attempt.abort(), 8_000);
      let roomId: string | undefined;
      let didFail = false;
      try {
        if (!code) throw new Error("ROOM_CODE_REQUIRED");
        roomId = savedRoomId(code) ?? savedRoomId(code.toUpperCase());
        let cap = roomId
          ? autoAudience
            ? audienceCapabilityFor(roomId)
            : capabilityFor(roomId)
          : undefined;
        if (!cap && awaitingOwner) return;
        if (autoAudience && (!cap || cap.role !== "audience")) {
          if (gameRuntime.joinAudience) {
            const audience = await gameRuntime.joinAudience(code, CLIENT_CHALLENGE_CAPABILITY, signal);
            if (signal.aborted || !alive) return;
            roomId = audience.roomId;
            saveAudienceCapability(roomId, { token: audience.token ?? "", role: "audience" });
          } else {
            const claim = await fetch(`/api/rooms/${code}/audience`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ challenge: CLIENT_CHALLENGE_CAPABILITY }),
              signal,
            });
            if (!claim.ok) throw await roomRequestError(claim);
            const audience = (await claim.json()) as {
              roomId: string;
              token: string;
            };
            if (signal.aborted || !alive) return;
            roomId = audience.roomId;
            saveAudienceCapability(roomId, {
              token: audience.token,
              role: "audience",
            });
          }
          saveRoomCode(code, roomId);
          cap = roomId ? audienceCapabilityFor(roomId) : undefined;
        }
        if (!cap && owner && !autoAudience) {
          const epoch = ownerEpoch(owner.uid);
          if (gameRuntime.kind === "firebase" && gameRuntime.restoreHostRoomAccess) {
            const restored = await gameRuntime.restoreHostRoomAccess(code);
            assertOwnerEpoch(epoch, signal);
            if (restored.roomCode !== code.toUpperCase() || !restored.roomId) throw new Error("NO_ROOM_SESSION");
            roomId = restored.roomId;
            cap = { role: "host", token: "" };
          } else if (isAlmaidanLocalDevelopment) {
            const idToken = await owner.getIdToken();
            assertOwnerEpoch(epoch, signal);
            const response = await fetch(`/api/rooms/${encodeURIComponent(code)}/owner-access`, {
              method: "POST", headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
              body: "{}", signal, credentials: "omit", redirect: "error", cache: "no-store",
            });
            if (!response.ok) throw await roomRequestError(response);
            const restored = await response.json();
            assertOwnerEpoch(epoch, signal);
            if (!isRoomUuid(restored?.roomId) || restored.roomCode !== code.toUpperCase()) throw new Error("NO_ROOM_SESSION");
            cap = parseRematchOwnerAccess(restored, restored.roomId);
            roomId = restored.roomId;
          }
          if (cap && roomId) {
            saveCapability(roomId, cap);
            saveRoomCode(code, roomId);
          }
        }
        if (!roomId || !cap)
          throw new Error("NO_ROOM_SESSION");
        const role = projectionRole ?? cap.role;
        // A local reload and audience display restore distinct route-owned
        // capabilities, so this singleton never reuses a previous room role.
        if (gameRuntime.kind === "local")
          gameRuntime.setCapabilityToken?.(cap.token);
        if (gameRuntime.kind === "local" && gameRuntime.resumeRoom)
          await gameRuntime.resumeRoom(roomId, CLIENT_CHALLENGE_CAPABILITY, signal);
        if (gameRuntime.kind === "firebase") {
          let subscriptionActive = true;
          const unsubscribe = gameRuntime.subscribeProjection(
            roomId,
            role,
            "",
            (value) => {
              if (!alive || !subscriptionActive || terminal || signal.aborted) return;
              const next = value as ProjectionEnvelope<ViewProjection>;
              if ((envelopeRef.current?.revision ?? -1) > next.revision) return;
              installProjection(next);
              if (value.authoritative === false) {
                setConnection("stale");
              } else {
                retryDelay = 1_000;
                setConnection("connected");
                setError("");
              }
            },
            (reason) => {
              if (!alive || !subscriptionActive || terminal || signal.aborted) return;
              if (isTerminalRoomError(reason)) stop(reason, roomId);
              else {
                subscriptionActive = false;
                closeSocket();
                setConnection("reconnecting");
                setError(readableError(reason));
                schedule(() => void connect());
              }
            },
          );
          socketRef.current = {
            readyState: WebSocket.OPEN,
            close: () => { subscriptionActive = false; unsubscribe(); },
          } as unknown as WebSocket;
          if (terminal || !subscriptionActive) {
            closeSocket();
            return;
          }
          if (role === "host" && gameRuntime.subscribeHostPresence)
            presenceStop.current = gameRuntime.subscribeHostPresence(
              roomId,
              acceptPresence,
              () => setPresence(null),
            );
          else if (role === "player" && gameRuntime.startPlayerPresence)
            presenceStop.current = gameRuntime.startPlayerPresence(roomId);
          return;
        }
        const challengeQuery = encodeURIComponent(JSON.stringify(CLIENT_CHALLENGE_CAPABILITY));
        const response = await fetch(`/api/rooms/${roomId}?challenge=${challengeQuery}`, {
          headers: { authorization: `Bearer ${cap.token}` },
          signal,
        });
        if (!response.ok) throw await roomRequestError(response);
        const snapshot =
          (await response.json()) as ProjectionEnvelope<ViewProjection>;
        if (!alive || !online() || signal.aborted) return;
        installProjection(snapshot);
        setConnection("connected");
        setError("");
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const socket = new WebSocket(
          `${protocol}//${location.host}/ws?roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(cap.token)}&challenge=${challengeQuery}`,
        );
        socketRef.current = socket;
        socket.onmessage = (event) => {
          if (socketRef.current !== socket || terminal) return;
          const value = JSON.parse(String(event.data)) as
            | (ProjectionEnvelope<ViewProjection> & { error?: string })
            | (HostPresenceSnapshot & { type: "presence" });
          if ((value as { type?: string }).type === "presence") {
            acceptPresence(value as HostPresenceSnapshot);
            return;
          }
          const envelopeValue = value as ProjectionEnvelope<ViewProjection> & {
            error?: string;
          };
          if (envelopeValue.error) {
            if (isTerminalRoomError(envelopeValue.error)) {
              stop(new Error(envelopeValue.error), roomId);
              return;
            }
            setError(readableError(new Error(envelopeValue.error)));
            return;
          }
          // HTTP intent acknowledgements can arrive before an older queued
          // WebSocket snapshot. Never let that older snapshot resurrect a
          // retained terminal challenge after CONTINUE.
          if ((envelopeRef.current?.revision ?? -1) > envelopeValue.revision)
            return;
          installProjection(envelopeValue);
          retryDelay = 1_000;
          setConnection("connected");
        };
        socket.onclose = (event) => {
          if (socketRef.current !== socket) return;
          socketRef.current = undefined;
          setPresence(null);
          // 4403: this seat was removed or can no longer read the room; reconnecting cannot help.
          if ([4401, 4403, 4404].includes(event.code)) {
            stop(new Error(event.reason || "SEAT_REMOVED"), roomId);
            return;
          }
          if (alive && online()) {
            setConnection("reconnecting");
            schedule(() => void connect());
          }
        };
        socket.onerror = () => socket.close();
      } catch (reason) {
        if (!alive || terminal || !online()) return;
        if (isTerminalRoomError(reason)) {
          stop(reason, roomId);
          return;
        }
        setError(readableError(reason));
        didFail = true;
        setConnection("reconnecting");
      } finally {
        window.clearTimeout(timeout);
        if (connecting === attempt) connecting = undefined;
        if (didFail || signal.aborted) schedule(() => void connect());
      }
    };
    const offline = () => {
      clearRetry();
      closeSocket();
      setConnection("offline");
    };
    const reconnect = () => {
      if (!alive || terminal) return;
      setConnection("reconnecting");
      schedule(() => void connect());
    };
    const visible = () => {
      if (document.visibilityState !== "visible") return;
      latestPresenceServerTime.current = 0;
      setPresence(null);
      const socket = socketRef.current;
      if (
        gameRuntime.kind === "local" &&
        socket?.readyState === WebSocket.OPEN
      ) {
        const refreshId =
          typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`;
        expectedPresenceRefresh.current = refreshId;
        socket.send(JSON.stringify({ type: "presence-refresh", refreshId }));
      }
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", reconnect);
    const signedOut = () => { if (!autoAudience) stop(new Error("NO_ROOM_SESSION")); };
    window.addEventListener(huroofSessionsCleared, signedOut);
    document.addEventListener("visibilitychange", visible);
    if (online()) void connect();
    else offline();
    return () => {
      alive = false;
      retryScope.abort();
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", reconnect);
      window.removeEventListener(huroofSessionsCleared, signedOut);
      document.removeEventListener("visibilitychange", visible);
      clearRetry();
      closeSocket();
    };
  }, [autoAudience, code, installProjection, projectionRole, pg, owner, awaitingOwner]);
  const freshReadyProjection = (
    previous: ProjectionEnvelope<ViewProjection>,
    signal: AbortSignal,
  ) => new Promise<ProjectionEnvelope<ViewProjection>>((resolve, reject) => {
    const settle = (next?: ProjectionEnvelope<ViewProjection>) => {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
      projectionListeners.current.delete(check);
      if (next) resolve(next);
      else reject(new Error("STALE_REVISION"));
    };
    const cancel = () => settle();
    const check = () => {
      if (signal.aborted) return cancel();
      const next = envelopeRef.current;
      if (!next || next.roomId !== previous.roomId || next.role !== "player" ||
          next.projection.self?.uid !== previous.projection.self?.uid || next.projection.room.state !== "LOBBY") return cancel();
      if (next.authoritative !== false && next.revision > previous.revision) settle(next);
    };
    const timeout = window.setTimeout(cancel, 5_000);
    signal.addEventListener("abort", cancel, { once: true });
    projectionListeners.current.add(check);
    check();
  });
  const send = async (
    type: IntentType,
    payload: Record<string, unknown> = {},
  ):Promise<void> => {
    if (connection !== "connected") throw new Error("CONNECTION_UNAVAILABLE");
    const currentEnvelope = envelopeRef.current ?? envelope;
    if (!currentEnvelope) throw new Error("PROJECTION_UNAVAILABLE");
    if (code && parseRoomLocator(code).backend === "pg") {
      if (!pg) throw new Error("PG_UNAVAILABLE");
      await pg.submitGameIntent(currentEnvelope.roomId, { type, payload, expectedRevision: currentEnvelope.revision, intentId: createGameIntentId() });
      return;
    }
    // The engine permits early finish only from a paused game. Use the
    // acknowledged pause revision, so the confirmation never sends a stale end.
    if (gameRuntime.kind !== "firebase" && type === 'END_WITHOUT_WINNER' && !['PAUSED', 'QUESTION_FAILED'].includes(currentEnvelope.projection.room.state)) {
      await send('PAUSE');
      return send(type,payload);
    }
    const submit = async (attempt: ProjectionEnvelope<ViewProjection>) => {
      const intent = { type, payload, expectedRevision: attempt.revision, intentId: createGameIntentId() };
      if (gameRuntime.kind === "firebase") {
        try {
          const result = await gameRuntime.submitGameIntent(attempt.roomId, intent);
          if (type === "LOBBY_SET_READY" && result && "stale" in result && result.stale === true)
            throw new Error("STALE_REVISION");
        } catch (reason) {
          if (type === "LOBBY_SET_READY" && reason instanceof Error && "code" in reason &&
              reason.code === "functions/aborted" && reason.message === "stale-revision")
            throw new Error("STALE_REVISION");
          throw reason;
        }
        return;
      }
      const cap = capabilityFor(attempt.roomId);
      if (!cap) throw new Error("CAPABILITY_UNAVAILABLE");
      const response = await fetch(
        `/api/rooms/${attempt.roomId}/intents`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${cap.token}`,
          },
          body: JSON.stringify(intent),
        },
      );
      const result = (await response.json()) as LocalIntentResponse;
      if (!response.ok) throw new Error(result.error ?? "تعذر تنفيذ العملية.");
      applyLocalIntentResponse(result, installProjection);
    };
    const scope = readyRetryScope.current;
    try {
      await submit(currentEnvelope);
    } catch (reason) {
      if (type !== "LOBBY_SET_READY" || currentEnvelope.role !== "player" ||
          currentEnvelope.projection.room.state !== "LOBBY" || !currentEnvelope.projection.self ||
          !scope || !(reason instanceof Error) || reason.message !== "STALE_REVISION") throw reason;
      const next = await freshReadyProjection(currentEnvelope, scope);
      if (scope.aborted || envelopeRef.current !== next) throw reason;
      if (next.projection.self?.ready !== payload.ready) await submit(next);
    }
  };
  return { envelope, connection, error, presence, send, reportError: setError };
}

export function QuestionReadingShield({ children, state, team, deadlineAt, serverTime }: {
  children: ReactNode; state: string; team?: "horizontal" | "vertical"; deadlineAt?: string; serverTime: string;
}) {
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const remaining = deadlineAt ? Date.parse(deadlineAt) - Date.parse(serverTime) : 0;
    const active = state === "FIRST_ANSWER" && Boolean(team) && remaining > 0;
    setRunning(active);
    if (!active) return;
    const timeout = window.setTimeout(() => setRunning(false), remaining);
    return () => window.clearTimeout(timeout);
  }, [state, team, deadlineAt, serverTime]);
  return <span className={`question-reading-shield${running ? " is-covered" : ""}`} data-team={team}>
    <span>{children}</span>
    {running && <span className="sr-only">وقت إجابة الفريق — توقفت قراءة السؤال</span>}
  </span>;
}

function Countdown({
  deadlineAt,
  serverTime,
  onDeadline,
}: {
  deadlineAt?: string;
  serverTime: string;
  onDeadline?: () => void;
}) {
  const [clientNow, setClientNow] = useState(() => Date.now());
  const offset = useMemo(
    () => Date.parse(serverTime) - Date.now(),
    [serverTime],
  );
  const fired = useRef<string | undefined>(undefined);
  useEffect(() => {
    setClientNow(Date.now());
    if (!deadlineAt) return;
    const timer = window.setInterval(() => setClientNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [deadlineAt, offset]);
  useEffect(() => {
    if (
      deadlineAt &&
      Date.parse(deadlineAt) <= clientNow + offset &&
      fired.current !== deadlineAt
    ) {
      fired.current = deadlineAt;
      onDeadline?.();
    }
  }, [clientNow, deadlineAt, offset, onDeadline]);
  if (!deadlineAt) return null;
  const seconds = Math.max(
    0,
    Math.ceil((Date.parse(deadlineAt) - (clientNow + offset)) / 1000),
  );
  const text = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <p
      className="timer"
      aria-label="الوقت المتبقي"
      data-testid="countdown"
      dir="ltr"
      role="timer"
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {text}
    </p>
  );
}

type TeamAxis = "horizontal" | "vertical";
type AssignmentTarget = { memberUid: string } | { manualParticipantId: string };
const targetForMember = (member: TeamMember): AssignmentTarget | undefined =>
  member.manualParticipantId
    ? { manualParticipantId: member.manualParticipantId }
    : member.uid
      ? { memberUid: member.uid }
      : undefined;
const targetKey = (target: AssignmentTarget) =>
  "manualParticipantId" in target
    ? `manual:${target.manualParticipantId}`
    : `member:${target.memberUid}`;
const parseAssignmentTarget = (value: string): AssignmentTarget | undefined => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const item = parsed as Record<string, unknown>;
      if (typeof item.memberUid === "string" && item.memberUid)
        return { memberUid: item.memberUid };
      if (
        typeof item.manualParticipantId === "string" &&
        item.manualParticipantId
      )
        return { manualParticipantId: item.manualParticipantId };
    }
  } catch {
    /* Legacy drag payloads use a raw device UID. */
  }
  return value ? { memberUid: value } : undefined;
};
type TeamAssignment = {
  busy: boolean;
  draggedTarget?: AssignmentTarget;
  enabled: boolean;
  onAssign: (target: AssignmentTarget, team: TeamAxis) => void;
  onDragEnd: () => void;
  onDragStart: (target: AssignmentTarget) => void;
  onDrop: (team: TeamAxis, target?: AssignmentTarget) => void;
  teams: NonNullable<SafeProjection["room"]["teams"]>;
};
type TeamMember = NonNullable<SafeProjection["room"]["members"]>[number];
const rosterKey = (member: TeamMember, index: number) => member.seatId ?? member.manualParticipantId ?? member.uid ?? index;

function HostPlayerCapsule({
  assignment,
  member,
  presence,
  showReadiness = false,
}: {
  assignment?: TeamAssignment;
  member: TeamMember;
  presence?: PlayerPresenceState;
  showReadiness?: boolean;
}) {
  const dragEndedAt = useRef(0);
  const presenceLabel =
    presence === "connected"
      ? "متصل"
      : presence === "disconnected"
        ? "غير متصل"
        : "حالة الاتصال غير معروفة";
  const status =
    member.participation === "manual" ? (
      <span className="host-player-capsule__manual">بدون بازر</span>
    ) : (
      <span
        className={`host-player-capsule__presence host-player-capsule__presence--${presence ?? "unknown"}`}
      >
        <i aria-hidden="true" />
        {presenceLabel}
      </span>
    );
  if (!assignment)
    return (
      <span className="host-player-capsule host-player-capsule--static">
        <span><bdi>{member.displayName}</bdi></span>
        {status}
      </span>
    );
  const destination = member.team === "horizontal" ? "vertical" : "horizontal";
  const target = targetForMember(member);
  const canMove = assignment.enabled && !assignment.busy && Boolean(target);
  return (
    <button
      aria-grabbed={Boolean(
        target &&
        assignment.draggedTarget &&
        targetKey(target) === targetKey(assignment.draggedTarget),
      )}
      aria-label={`${member.displayName}${member.participation === "manual" ? "، بدون بازر" : `، ${presenceLabel}، ${member.ready ? "جاهز" : "بانتظار الجاهزية"}`}، انقل إلى ${teamName(assignment.teams[destination])}`}
      className="host-player-capsule"
      data-member-uid={member.uid}
      data-manual-participant-id={member.manualParticipantId}
      data-presence-state={
        member.participation === "manual" ? undefined : (presence ?? "unknown")
      }
      data-target-key={target ? targetKey(target) : undefined}
      data-testid="host-player-capsule"
      disabled={!canMove}
      draggable={canMove}
      onClick={(event) => {
        if (event.detail !== 0 && Date.now() - dragEndedAt.current < 250) {
          dragEndedAt.current = 0;
          return;
        }
        if (target) assignment.onAssign(target, destination);
      }}
      onDragEnd={() => {
        dragEndedAt.current = Date.now();
        assignment.onDragEnd();
      }}
      onDragStart={(event) => {
        if (!target) return;
        dragEndedAt.current = 0;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", JSON.stringify(target));
        assignment.onDragStart(target);
      }}
      type="button"
    >
      <span><bdi>{member.displayName}</bdi></span>
      {status}
      {member.participation !== "manual" && showReadiness ? (
        <span className="host-player-capsule__readiness">
          {member.ready ? "جاهز" : "بانتظار الجاهزية"}
        </span>
      ) : member.participation !== "manual" && member.ready ? (
        <span aria-label="جاهز" className="host-player-capsule__ready">
          <Icon kind="check" />
        </span>
      ) : null}
    </button>
  );
}

function RoundMarkers({
  axis,
  currentRound,
  roundResults,
}: {
  axis: TeamAxis;
  currentRound?: number;
  roundResults?: NonNullable<SafeProjection["roundResults"]>;
}) {
  return (
    <ol aria-label="جولات المباراة" className="round-markers">
      {[1, 2, 3, 4, 5].map((round) => {
        const result = roundResults?.find((item) => item.round === round);
        const status =
          result?.winner === axis
            ? "won"
            : result?.winner
              ? "lost"
              : currentRound === round
                ? "current"
                : "pending";
        return (
          <li
            aria-label={`الجولة ${round}: ${status === "won" ? "فوز" : status === "lost" ? "خسارة" : status === "current" ? "الحالية" : "بانتظار"}`}
            className={`round-markers__marker round-markers__marker--${status}`}
            data-round={round}
            key={round}
          >
            <svg aria-hidden="true" viewBox="0 0 12 12">
              <circle cx="6" cy="6" r="5" />
            </svg>
          </li>
        );
      })}
    </ol>
  );
}

export function TeamScoreCard({
  axis,
  assignment,
  players,
  presence,
  currentRound,
  points,
  roundResults,
  rounds,
  testId,
  teamName: customName,
  variant,
}: {
  axis: TeamAxis;
  assignment?: TeamAssignment;
  players?: NonNullable<SafeProjection["room"]["members"]>;
  presence?: HostPresenceSnapshot["players"];
  currentRound?: number;
  points: number;
  roundResults?: NonNullable<SafeProjection["roundResults"]>;
  rounds: number;
  testId?: string;
  teamName?: string;
  variant: "host" | "stage";
}) {
  const label = axis === "vertical" ? "الأخضر" : "الأحمر";
  return (
    <section
      aria-label={`فريق ${label}: ${teamName(customName)}، محور ${axis === "vertical" ? "عمودي" : "أفقي"}`}
      className={`team-score-card team-score-card--${axis} ${variant}-score ${variant}-score--${axis}`}
      data-testid={testId}
      onDragOver={(event) => {
        if (assignment?.enabled && assignment.draggedTarget)
          event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (assignment?.enabled && !assignment.busy)
          assignment.onDrop(
            axis,
            parseAssignmentTarget(event.dataTransfer.getData("text/plain")),
          );
      }}
    >
      {variant === "stage" ? (
        <span aria-hidden="true" className="stage-score__medallion">
          <svg viewBox="0 0 24 24">
            <path d="M8 3h8l-1 6h-6L8 3Z" />
            <path d="M9 5 5 7l4 5M15 5l4 2-4 5" />
            <path d="M8 10h8v3a4 4 0 0 1-8 0v-3Z" />
            <path d="M12 17v3M9 21h6" />
          </svg>
        </span>
      ) : null}
      <span className={`team-score-card__team ${variant}-score__team`}>
        {variant === "host" ? (customName ? teamName(customName) : `فريق ${label}`) : label}
      </span>
      <div className="team-score__rounds">
        <strong
          data-testid={
            testId ? `${testId.replace("score", "round-wins")}` : undefined
          }
        >
          {rounds}
        </strong>
        <small>الجولات</small>
        {variant === "host" && (
          <RoundMarkers
            axis={axis}
            currentRound={currentRound}
            roundResults={roundResults}
          />
        )}
      </div>
      <div className={`team-score__points ${variant}-score__points`}>
        <span aria-hidden="true" className="team-score__points-label">
          النقاط
        </span>
        <strong aria-hidden="true" className="team-score__points-value">
          {points}
        </strong>
        <span className="sr-only">نقاط الإجابات: {points}</span>
      </div>
      {players?.length ? (
        <section
          className={`team-score__players ${assignment?.draggedTarget ? "is-drop-target" : ""}`}
          aria-label={`لاعبو ${label}`}
        >
          <ul>
            {players.map((player, index) => (
              <li key={rosterKey(player, index)}>
                <HostPlayerCapsule
                  assignment={assignment}
                  member={player}
                  presence={
                    player.uid ? presence?.[player.uid]?.state : undefined
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

const noAnswerMessage = "انتهى الوقت — ما أحد جاوب";

function nextSelectionMessage(projection: SafeProjection) {
  const choice = projection.room.matchSettings?.gameKind === "categories" ? "الفئة التالية" : "الحرف التالي";
  const hasAward = Boolean(projection.questionScores?.horizontal || projection.questionScores?.vertical);
  const selector = hasAward && projection.entitledTeam
    ? teamName(projection.room.teams?.[projection.entitledTeam] ?? (projection.entitledTeam === "vertical" ? "الأخضر" : "الأحمر"))
    : "المضيف";
  return `${selector} يختار ${choice}`;
}

export function BoardStatusStrip({ projection, serverTime, presentationContext, onDeadline, readingCountdown = true }: { projection: SafeProjection; serverTime: string; presentationContext?: BoardPresentationContext; onDeadline?: () => void; readingCountdown?: boolean }) {
  const state = projection.room.state;
  const answering = (state === "FIRST_ANSWER" || state === "OPPONENT_CHANCE")
    ? projection.answeringTeam ?? projection.entitledTeam : undefined;
  const category = projection.board?.find((cell) => cell.id === projection.activeCellId)?.categoryLabelAr || projection.question?.headerAr;
  const label = answering ? projection.room.teams?.[answering] || (answering === "vertical" ? "الفريق الأخضر" : "الفريق الأحمر")
    : state === "CELL_SELECTION" ? nextSelectionMessage(projection)
      : state === "QUESTION_FAILED" && projection.questionFailedReason === "no-answer" ? noAnswerMessage : stateLabel(state);
  return <section className={`board-status-strip ${presentationContext?.event === "buzzer" ? "board-status-strip--buzzer" : ""}`} aria-label="حالة اللعب" data-event={presentationContext?.event} data-team={answering}>
    <div className="board-status-strip__copy" role="status">
      <strong title={label}>{projection.contentHold ? "توقف المحتوى" : label}</strong>
      <small title={category}>{category || "\u00a0"}</small>
    </div>
    {projection.deadlineAt && state !== "PAUSED" && (readingCountdown || state !== "QUESTION_READING") ? <div className="board-status-strip__timer">
      <Countdown deadlineAt={projection.deadlineAt} serverTime={serverTime} onDeadline={onDeadline} />
    </div> : <div className="board-status-strip__timer" aria-hidden="true" />}
  </section>;
}

function matchWinner(projection: SafeProjection): string | undefined {
  return projection.matchWinner
    ? teamName(projection.room.teams?.[projection.matchWinner] ?? (projection.matchWinner === "vertical" ? "الأخضر" : "الأحمر"))
    : undefined;
}
function matchReason(projection: SafeProjection): string | undefined {
  return projection.matchWinReason === "two_consecutive_round_wins"
    ? "بجولتين متتاليتين"
    : projection.matchWinReason === "three_total_round_wins"
      ? "بثلاث جولات إجمالاً"
      : undefined;
}

function usePlayerAnswerFeedback(
  result: SafeProjection["answerFeedback"],
  serverTime?: string,
  teams?: SafeProjection["room"]["teams"],
) {
  const lastExpiry = useRef<string>(undefined);
  const [active, setActive] = useState<{ result: NonNullable<SafeProjection["answerFeedback"]>; visibleFor: number }>();
  useEffect(() => {
    if (!result || result.expiresAt === lastExpiry.current) return;
    const remaining = Date.parse(result.expiresAt) - Date.parse(serverTime ?? "");
    if (remaining <= 0 || !Number.isFinite(remaining)) return;
    lastExpiry.current = result.expiresAt;
    setActive({ result, visibleFor: Math.min(3_000, remaining) });
  }, [result, serverTime]);
  useEffect(() => {
    if (!active) return;
    const timeout = window.setTimeout(() => setActive(undefined), active.visibleFor);
    return () => window.clearTimeout(timeout);
  }, [active]);
  if (!active) return undefined;
  if (active.result.outcome === "incorrect") return "إجابة خاطئة — الفرصة للفريق الآخر";
  const axis = active.result.team;
  const name = axis ? teams?.[axis] ?? (axis === "vertical" ? "الأخضر" : "الأحمر") : undefined;
  return name ? `إجابة صحيحة — الخلية ل${teamName(name)}` : "إجابة صحيحة";
}

function HuroofGuideLink({ className }: { className?: string }) {
  return <Link className={className} to="/how-to-play#rules-khaliah" target="_blank" rel="noopener noreferrer">كيف نلعب؟</Link>;
}

function ConnectionStatus({ value }: { value: string }) {
  return (
    <p className={`connection connection--${value}`} role="status">
      {connectionLabel(value)}
    </p>
  );
}
function BuzzWinnerBanner({
  winner,
}: {
  winner: NonNullable<SafeProjection["buzzWinner"]>;
}) {
  return (
    <p className={`buzz-winner buzz-winner--${winner.team}`} role="status">
      {winner.method === "host" ? "اختيار المضيف:" : "الأسرع:"}{" "}
      <bdi>{winner.displayName}</bdi>
    </p>
  );
}

function EndWithoutWinnerDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return <ConfirmDialog open={open} title="إنهاء المباراة بلا فائز" testId="end-without-winner-dialog"
    description="بتنتهي المباراة الآن بلا فائز." confirmLabel="إنهاء المباراة كاملةً"
    cancelLabel="متابعة اللعب" onCancel={onCancel} onConfirm={onConfirm} />;
}

export function HostActions({
  state,
  answeringTeam,
  action,
  playerCount,
  teams,
  entitledTeam,
  contentHold,
  gameKind = "huroof",
  questionFailedReason,
  prepareFailed = false,
  timerStopped = false,
}: {
  state: string;
  answeringTeam?: "horizontal" | "vertical";
  action: (type: IntentType, payload?: Record<string, unknown>) => void;
  playerCount: number;
  teams: NonNullable<SafeProjection["room"]["teams"]>;
  entitledTeam?: "horizontal" | "vertical";
  contentHold?: SafeProjection["contentHold"];
  gameKind?: "huroof" | "categories";
  questionFailedReason?: SafeProjection["questionFailedReason"];
  prepareFailed?: boolean;
  /** True when the question is open but its timer is stopped (answer revealed); local runtime only. */
  timerStopped?: boolean;
}) {
  const manualSelection =
    state === "QUESTION_READING" || state === "OPPONENT_CHANCE";
  const hostOnly = playerCount === 0;
  const selectionLabel = gameKind === "categories" ? "فئة" : "حرفًا";
  if (state === "MATCH_COMPLETE") return null;
  if (contentHold) {
    return (
        <div className="control-grid control-grid--content-hold" role="status">
          <p>
            توقف اختيار المحتوى: لا يتوفر بديل صالح لهذه الخطوة. لا تُحتسب أي نقطة
            ولا تتغير ملكية الخلية.
          </p>
        </div>
    );
  }
  return (
    <>
      <div
        className={`control-grid ${manualSelection && !hostOnly ? "control-grid--player-override" : ""}`}
      >
      {state === "CELL_SELECTION" && (
        <button
          className="button button--primary host-select-cell"
          type="button"
          onClick={() => {
            const cell = document.querySelector<HTMLButtonElement>(
              ".host-board .game-board__button:not(:disabled)",
            );
            cell?.scrollIntoView?.({ block: "center", behavior: "instant" });
            cell?.focus({ preventScroll: true });
          }}
        >
          {`اختر ${selectionLabel} من اللوحة`}
        </button>
      )}
      {state === "FIRST_ANSWER" && (
        <div className="host-answer-judgment" data-team={answeringTeam}>
          <button
            className="button button--primary"
            onClick={() => action("JUDGE_CORRECT")}
          >
            إجابة صحيحة
          </button>
          <button className="button" onClick={() => action("JUDGE_INCORRECT")}>
            إجابة خاطئة
          </button>
        </div>
      )}
      {state === "QUESTION_FAILED" && (
        <>
          <p className="host-failure-summary" role="status">
            {questionFailedReason === "no-answer" ? noAnswerMessage : "لم تُمنح الخلية لأي فريق."}
          </p>
          <button
            className="button button--primary"
            onClick={() => action("RETRY_CELL")}
          >
            {gameKind === "categories" ? "كمّلوا — اختاروا فئة ثانية" : "كمّلوا — اختاروا حرفاً آخر"}
          </button>
        </>
      )}
      {state === "PAUSED" && (
        <>
          <p role="status">المباراة متوقفة مؤقتًا.</p>
        </>
      )}
      {state === "ROUND_SETUP" && (prepareFailed ? (
        <button className="button button--primary" onClick={() => action("ROUND_READY")} type="button">أعد تجهيز الجولة</button>
      ) : <p role="status">جارٍ تجهيز الجولة…</p>)}
      {state === "ROUND_COMPLETE" && (
        <button
          className="button button--primary"
          onClick={() => action("START_NEXT_ROUND")}
        >
          جولة جديدة
        </button>
      )}
      {manualSelection && (
        <section
          className="host-team-selection"
          aria-label="اختيار فريق الإجابة"
        >
          <div>
            {(["horizontal", "vertical"] as const).map((team) => (
              <button
                aria-label={`اختيار ${teams[team]} للإجابة`}
                className={`button host-team-selection__button host-team-selection__button--${team}`}
                data-testid={`host-select-${team}`}
                disabled={state === "OPPONENT_CHANCE" && entitledTeam !== team}
                key={team}
                onClick={() => action("HOST_SELECT_TEAM", { team })}
              >
                <span>{teamName(teams[team])}</span>
              </button>
            ))}
          </div>
          {timerStopped ? (
            <button
              className="button host-close-question"
              data-testid="host-close-question"
              onClick={() => action("CLOSE_QUESTION")}
              type="button"
            >
              لم يُجب أحد — أغلق السؤال
            </button>
          ) : null}
        </section>
      )}
      </div>
    </>
  );
}

export function EndWithoutWinnerControl({ action }: { action: (type: IntentType) => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <div className="huroof-end-tools">
    <button className="button button--quiet" onClick={() => setOpen(true)} ref={trigger} type="button">
      إنهاء المباراة كاملةً بلا فائز
    </button>
    <EndWithoutWinnerDialog open={open} onCancel={() => {
      setOpen(false);
      window.requestAnimationFrame(() => trigger.current?.focus());
    }} onConfirm={() => {
      setOpen(false);
      action("END_WITHOUT_WINNER");
    }} />
  </div>;
}

export function HostPauseAction({
  state,
  action,
  contentHold = false,
}: {
  state: string;
  action: (type: IntentType, payload?: Record<string, unknown>) => void;
  contentHold?: boolean;
}) {
  if (state === "CORRECTION" || state === "MATCH_COMPLETE" || contentHold)
    return null;
  return (
    <button
      className="button button--quiet host-controls__pause"
      onClick={() => action(state === "PAUSED" ? "RESUME" : "PAUSE")}
      type="button"
    >
      {state === "PAUSED" ? "استئناف" : "إيقاف مؤقت"}
    </button>
  );
}

export function HostVisibilityControls({
  audienceQuestionVisible,
  disabled,
  readOnlyReason,
  onAudienceQuestionChange,
  onHostAnswerChange,
  showHostAnswer,
}: {
  audienceQuestionVisible: boolean;
  disabled: boolean;
  readOnlyReason?: string;
  onAudienceQuestionChange: (visible: boolean) => void;
  onHostAnswerChange: (visible: boolean) => void;
  showHostAnswer: boolean;
}) {
  return (
    <section className="host-visibility-controls">
      <label className="host-visibility-control">
        <span>إظهار الإجابة للمضيف</span>
        <input
          checked={showHostAnswer}
          data-testid="host-show-answer"
          onChange={(event) => onHostAnswerChange(event.target.checked)}
          type="checkbox"
        />
      </label>
      <label className="host-visibility-control">
        <span>إظهار السؤال على شاشة العرض</span>
        <input
          checked={audienceQuestionVisible}
          data-testid="host-show-audience-question"
          disabled={disabled}
          onChange={(event) => onAudienceQuestionChange(event.target.checked)}
          type="checkbox"
        />
      </label>
      {readOnlyReason ? (
        <p className="form-message" role="status">
          {readOnlyReason}
        </p>
      ) : null}
    </section>
  );
}

export const audienceQuestionBandVisible = (
  audienceQuestionVisible: boolean,
  state: string,
  prompt?: string,
) =>
  state === "MATCH_COMPLETE" || (audienceQuestionVisible &&
    state !== "CELL_SELECTION" &&
      state !== "ROUND_SETUP" &&
      Boolean(prompt?.trim()));

/** Cached/offline projections may render safe text, but never retain a media grant. */
const activeImageStatesForView = new Set([
  "PAUSED",
  "QUESTION_READING",
  "FIRST_ANSWER",
  "OPPONENT_CHANCE",
  "QUESTION_FAILED",
]);
export const canRenderCurrentQuestionMedia = ({
  audienceQuestionVisible,
  authoritative,
  connection,
  role,
  state,
  surface,
}: {
  audienceQuestionVisible?: boolean;
  authoritative?: boolean;
  connection: string;
  role: "host" | "player" | "audience";
  state: string;
  surface: "lobby" | "host" | "play" | "display" | "results";
}) => {
  if (connection !== "connected" || authoritative === false) return false;
  if (role === "audience" && audienceQuestionVisible === false) return false;
  if (role === "host") return surface === "host";
  return (
    role === "audience" &&
    surface === "display" &&
    activeImageStatesForView.has(state)
  );
};

export const shouldShowHostAnswers = (
  showHostAnswer: boolean,
  question: ViewProjection["question"] | undefined,
) => showHostAnswer && Boolean(question);

export function HostLobbyControls({
  action,
  allowRemoval = gameRuntime.kind === "local" || gameRuntime.kind === "firebase",
  busy,
  canStart,
  connection,
  error,
  fixture,
  presence,
  room,
  showStart = true,
  visibilityControls,
}: {
  action: (
    type: IntentType,
    payload?: Record<string, unknown>,
  ) => Promise<boolean | void>;
  allowRemoval?: boolean;
  busy: boolean;
  canStart: boolean;
  connection: string;
  error: string;
  fixture: boolean;
  presence?: HostPresenceSnapshot["players"];
  room: SafeProjection["room"];
  showStart?: boolean;
  visibilityControls?: ReactNode;
}) {
  const players = (room.members ?? []).filter(
    (member) => member.role === "player",
  );
  const devicePlayers = players.filter(
    (member) => member.participation !== "manual",
  );
  const state = room.state;
  const canManage =
    !fixture && connection === "connected" && canManageTeamsInState(state);
  const [draggedTarget, setDraggedTarget] = useState<AssignmentTarget>();
  const [manualFormOpen, setManualFormOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualTeam, setManualTeam] = useState<TeamAxis>("horizontal");
  const [manualError, setManualError] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<string>();
  const removeConfirmation = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (pendingRemoval) removeConfirmation.current?.focus();
  }, [pendingRemoval]);
  const canRemove = canManage && state === "LOBBY" && allowRemoval;
  const removeParticipant = (target: AssignmentTarget) => {
    setPendingRemoval(undefined);
    void Promise.resolve(action("LOBBY_REMOVE_PARTICIPANT", { ...target })).catch(() => undefined);
  };
  const focusTargetKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    const key = focusTargetKey.current;
    if (!key) return;
    const target = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-target-key]"),
    ).find((element) => element.dataset.targetKey === key);
    if (target) {
      target.focus();
      focusTargetKey.current = undefined;
    }
  }, [room.members]);
  const teamMembers = (team: "horizontal" | "vertical") =>
    players.filter((member) => member.team === team);
  const unassignedMembers = players.filter((member) => !member.team);
  const blockedMessage = fixture
    ? "إدارة اللاعبين غير متاحة في المعاينة الثابتة."
    : connection !== "connected"
      ? "تأكدوا من اتصالكم عشان تديرون غرفة الانتظار."
      : !canManageTeamsInState(state)
        ? "نقل اللاعبين مقفل أثناء السؤال أو الإجابة أو الإيقاف أو التصحيح أو بعد اكتمال المباراة."
        : room.startBlockedReason
          ? "بانتظار جاهزية الجميع وتوزيع اللاعبين على الفريقين."
          : players.length
            ? "المباراة جاهزة بعد اكتمال الفريقين."
            : "وضع المضيف فقط جاهز: ستتحكم بالفريقين يدوياً.";
  const assignTeam = (target: AssignmentTarget, team: TeamAxis) => {
    focusTargetKey.current = targetKey(target);
    void Promise.resolve(
      action("LOBBY_ASSIGN_TEAM", { ...target, team }),
    ).catch(() => undefined);
  };
  const assignment: TeamAssignment = {
    busy: busy || manualBusy,
    draggedTarget,
    enabled: canManage,
    onAssign: assignTeam,
    onDragEnd: () => setDraggedTarget(undefined),
    onDragStart: setDraggedTarget,
    onDrop: (team, target) => {
      if (!canManage || busy || manualBusy) {
        setDraggedTarget(undefined);
        return;
      }
      const targetMember = target || draggedTarget;
      setDraggedTarget(undefined);
      if (targetMember) assignTeam(targetMember, team);
    },
    teams: room.teams ?? { horizontal: "الأحمر", vertical: "الأخضر" },
  };
  const assignmentCapsule = (member: TeamMember, index: number) => (
    <li
      className="host-lobby__member"
      key={rosterKey(member, index)}
    >
      <HostPlayerCapsule
        assignment={assignment}
        member={member}
        presence={member.uid ? presence?.[member.uid]?.state : undefined}
        showReadiness
      />
      {canRemove && targetForMember(member) ? (() => {
        const target = targetForMember(member)!;
        const key = targetKey(target);
        return pendingRemoval === key ? (
          <span className="host-lobby__remove-confirm">
            <button className="button button--quiet host-lobby__remove" data-testid="confirm-remove-participant" disabled={busy || manualBusy} onClick={() => removeParticipant(target)} ref={removeConfirmation} type="button">تأكيد إزالة <bdi>{member.displayName}</bdi></button>
            <button className="button button--quiet host-lobby__remove" onClick={() => setPendingRemoval(undefined)} type="button">تراجع</button>
          </span>
        ) : (
          <button aria-label={`إزالة ${member.displayName} من الغرفة`} className="button button--quiet host-lobby__remove" data-testid="remove-participant" disabled={busy || manualBusy} onClick={() => setPendingRemoval(key)} type="button">إزالة</button>
        );
      })() : null}
    </li>
  );
  return (
    <section className="host-lobby" aria-label="اللاعبون والفِرَق">
      <header className="host-lobby__summary">
        <p data-testid="host-lobby-member-count">
          {players.length} لاعبون منضمون · {room.readyCount} جاهزون
        </p>
      </header>
      <section className="manual-player" aria-label="إضافة لاعب بدون بازر">
        <button
          aria-expanded={manualFormOpen}
          className="manual-player__toggle"
          data-testid="manual-player-toggle"
          disabled={!canManage || busy}
          onClick={() => setManualFormOpen((open) => !open)}
          type="button"
        >
          إضافة لاعب بدون بازر
        </button>
        {manualFormOpen ? (
          <form
            className="manual-player__form"
            onSubmit={(event) => {
              event.preventDefault();
              const displayName = normalizePlayerDisplayName(manualName);
              if (!displayName) {
                setManualError(JOIN_NAME_MESSAGE);
                return;
              }
              setManualBusy(true);
              setManualError("");
              void action("LOBBY_ADD_MANUAL_PLAYER", {
                displayName,
                team: manualTeam,
              })
                .then((succeeded) => {
                  if (succeeded === false) {
                    setManualError(
                      "تعذر إضافة اللاعب. تحقق من الاتصال وحاول مرة أخرى.",
                    );
                    return;
                  }
                  setManualName("");
                  setManualFormOpen(false);
                })
                .catch((reason) => setManualError(readableError(reason)))
                .finally(() => setManualBusy(false));
            }}
          >
            <label>
              اسم اللاعب
              <input
                aria-describedby={
                  manualError ? "manual-player-error" : undefined
                }
                aria-invalid={Boolean(manualError)}
                data-testid="manual-player-name"
                onChange={(event) => {
                  setManualName(event.target.value);
                  if (manualError) setManualError("");
                }}
                value={manualName}
              />
            </label>
            <p className="manual-player__help">
              اللاعب المضاف جاهز تلقائياً ولا يستخدم البازر.
            </p>
            <div
              aria-label="فريق اللاعب"
              className="manual-player__teams"
              role="group"
            >
              {(["vertical", "horizontal"] as const).map((team) => (
                <button
                  aria-pressed={manualTeam === team}
                  className={`manual-player__team manual-player__team--${team}`}
                  data-testid={`manual-player-team-${team}`}
                  key={team}
                  onClick={() => setManualTeam(team)}
                  type="button"
                >
                  {teamName(room.teams?.[team])}
                </button>
              ))}
            </div>
            {manualError ? (
              <p className="form-message" id="manual-player-error" role="alert">
                {manualError}
              </p>
            ) : null}
            <button
              className="button"
              data-testid="add-manual-player"
              disabled={manualBusy}
              type="submit"
            >
              {manualBusy ? "جارٍ الإضافة…" : "إضافة"}
            </button>
          </form>
        ) : null}
      </section>
      <div className="host-lobby__teams">
        {(["horizontal", "vertical"] as const).map((team) => {
          const members = teamMembers(team);
          return (
            <section
              className={`host-lobby__team host-lobby__team--${team} ${draggedTarget ? "is-drop-target" : ""}`}
              data-testid={`host-lobby-team-${team}`}
              key={team}
              onDragOver={(event) => {
                if (
                  assignment.enabled &&
                  !assignment.busy &&
                  assignment.draggedTarget
                )
                  event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (assignment.enabled && !assignment.busy)
                  assignment.onDrop(
                    team,
                    parseAssignmentTarget(
                      event.dataTransfer.getData("text/plain"),
                    ),
                  );
              }}
            >
              <header className="host-lobby__team-header">
                <h3>{teamName(room.teams?.[team])}</h3>
                <bdi data-testid={`host-lobby-team-${team}-count`} dir="ltr">
                  {members.length}
                </bdi>
              </header>
              {members.length ? (
                <ul>{members.map(assignmentCapsule)}</ul>
              ) : (
                <p className="host-lobby__empty">
                  لا يوجد لاعب في هذا الفريق بعد.
                </p>
              )}
            </section>
          );
        })}
      </div>
      {unassignedMembers.length ? (
        <section
          className="host-lobby__unassigned"
          aria-label="لاعبون غير موزعين"
        >
          <h3>غير موزعين ({unassignedMembers.length})</h3>
          <ul>{unassignedMembers.map(assignmentCapsule)}</ul>
        </section>
      ) : null}
      {canManage && devicePlayers.length ? (
        <p aria-live="polite" className="host-lobby__notice">
          {showStart ? "نقل لاعب البازر يلغي جاهزيته." : "اضغطوا على اسم اللاعب لنقله للفريق الثاني. اللاعب يحتاج يجهّز من جديد."}
        </p>
      ) : null}
      {error ? (
        <p aria-live="polite" className="form-message">
          {error}
        </p>
      ) : null}
      <div className="host-lobby__status">
        <ConnectionStatus value={connection} />
      </div>
      {visibilityControls}
      {!showStart ? null : state === "LOBBY" ? (
        <section className="host-lobby__start" aria-label="بدء المباراة">
          <p data-testid="host-lobby-start-blocked">{blockedMessage}</p>
          <button
            className="button button--primary"
            data-testid="start-match"
            disabled={!canManage || busy || !canStart}
            onClick={() => void action("START_MATCH")}
            type="button"
          >
            {busy ? "جارٍ التحديث…" : "ابدأ المباراة"}
          </button>
        </section>
      ) : (
        <p className="host-lobby__locked" role="status">
          {blockedMessage}
        </p>
      )}
    </section>
  );
}

function HostTeamManagementStatus({ state }: { state: string }) {
  if (canManageTeamsInState(state)) return null;
  return (
    <p className="host-team-management-status" role="status">
      نقل اللاعبين مقفل أثناء السؤال أو الإجابة أو الإيقاف أو التصحيح أو بعد
      اكتمال المباراة.
    </p>
  );
}

type HostJoinLink = {
  copyLink: () => Promise<void>;
  copyStatus: string;
  origin: string;
  originIsInvalid: boolean;
  qrDataUrl: string;
  qrError: string;
  setOrigin: (origin: string) => void;
  joinUrl: string | undefined;
};

function useHostJoinLink(roomCode: string): HostJoinLink {
  const [origin, setOrigin] = useState(
    () =>
      import.meta.env?.VITE_PUBLIC_JOIN_ORIGIN ||
      (typeof window === "undefined" ? "" : window.location.origin),
  );
  const [qr, setQr] = useState<{ joinUrl: string; value: string }>();
  const [qrFailure, setQrFailure] = useState<{
    joinUrl: string;
    message: string;
  }>();
  const { copyText, localStatus: copyStatus } = useCopyStatus();
  const joinUrl = isAlmaidanLocalDevelopment ? `${window.location.origin}/room/${encodeURIComponent(roomCode)}/join` : playerJoinUrl(origin, roomCode);
  const originIsInvalid =
    !isAlmaidanLocalDevelopment && Boolean(origin.trim()) && !normalizedJoinOrigin(origin);
  const qrDataUrl = qr && qr.joinUrl === joinUrl ? qr.value : "";
  const qrError =
    qrFailure && qrFailure.joinUrl === joinUrl ? qrFailure.message : "";

  useEffect(() => {
    let cancelled = false;
    setQr(undefined);
    setQrFailure(undefined);
    if (isAlmaidanLocalDevelopment || !joinUrl) return;
    void QRCode.toDataURL(joinUrl, {
      color: { dark: "#071d38", light: "#ffffffff" },
      errorCorrectionLevel: "M",
      margin: 4,
      width: 280,
    })
      .then((value) => {
        if (!cancelled) setQr({ joinUrl, value });
      })
      .catch(() => {
        if (!cancelled)
          setQrFailure({
            joinUrl,
            message: "تعذر إنشاء رمز QR محلياً. يمكنك نسخ الرابط.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [joinUrl]);

  const copyLink = async () => {
    if (joinUrl) await copyText(joinUrl, "تم نسخ رابط الانضمام.", "ما قدرنا ننسخ رابط الانضمام.");
  };

  return {
    copyLink,
    copyStatus,
    joinUrl,
    origin,
    originIsInvalid,
    qrDataUrl,
    qrError,
    setOrigin,
  };
}

export function HostJoinInlineQr({
  join,
  onOpen,
}: {
  join: HostJoinLink;
  onOpen: () => void;
}) {
  if(isAlmaidanLocalDevelopment)return <aside className="lobby-join-qr"><p>شاركوا الرمز أو الرابط مع اللاعبين.</p><button className="button" type="button" onClick={()=>void join.copyLink()}>نسخ رابط الدعوة</button><p role="status">{join.copyStatus}</p></aside>;
  const status = join.joinUrl
    ? join.qrError || "امسح الرمز للانضمام إلى هذه المباراة."
    : join.originIsInvalid
      ? "عنوان الموقع غير صالح للهاتف. اضغط لتعديله."
      : "اضبط عنوان الموقع القابل للوصول لإظهار الرمز.";
  return (
    <aside className="lobby-join-qr" aria-label="انضمام اللاعبين برمز QR">
      <button
        aria-describedby="lobby-join-qr-caption"
        aria-label={
          join.qrError
            ? "فتح إعدادات رمز QR بعد تعذر إنشائه"
            : join.joinUrl
              ? "تكبير رمز QR للانضمام"
              : "إعداد عنوان انضمام اللاعبين"
        }
        className="lobby-join-qr__trigger"
        data-testid="lobby-join-qr"
        onClick={onOpen}
        type="button"
      >
        <span className="lobby-join-qr__code">
          {join.qrDataUrl ? (
            <img alt="رمز QR لرابط انضمام اللاعب" src={join.qrDataUrl} />
          ) : join.qrError ? (
            <span role="alert">تعذر إنشاء الرمز</span>
          ) : (
            <span role="status">
              {join.joinUrl ? "جارٍ إنشاء الرمز…" : "إعداد رمز الانضمام"}
            </span>
          )}
        </span>
        <span className="lobby-join-qr__label">رمز QR للانضمام</span>
      </button>
      <p id="lobby-join-qr-caption">{status}</p>
    </aside>
  );
}

export function HostJoinDialog({
  join,
  onDismiss,
  open,
}: {
  join: HostJoinLink;
  onDismiss: () => void;
  open: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      aria-labelledby="host-join-qr-title"
      className="host-join-dialog"
      onClose={onDismiss}
      ref={dialogRef}
    >
      <section className="host-join-dialog__surface">
        <header className="host-join-dialog__header">
          <div>
            <p className="eyebrow">انضمام لاعب</p>
            <h2 id="host-join-qr-title">امسح رمز QR للانضمام</h2>
          </div>
          <button
            aria-label="إغلاق رمز الانضمام"
            className="host-join-dialog__close"
            onClick={() => {
              if (typeof dialogRef.current?.close === "function")
                dialogRef.current.close();
              else onDismiss();
            }}
            type="button"
          >
            ×
          </button>
        </header>
        <p>امسح الرمز، أدخل اسمك، وانضم إلى المباراة.</p>
        <label className="host-join-dialog__origin">
          <span>عنوان الموقع للاعبين</span>
          <input
            aria-describedby="host-join-origin-help"
            dir="ltr"
            inputMode="url"
            onChange={(event) => join.setOrigin(event.target.value)}
            placeholder="http://192.168.1.10:5173"
            value={join.origin}
          />
        </label>
        <p className="host-join-dialog__hint" id="host-join-origin-help">
          {join.originIsInvalid
            ? "استخدم عنوان http أو https عاماً أو من الشبكة المحلية. لا يمكن مسح localhost من هاتف."
            : "عند تشغيل التطبيق على localhost، أدخل عنوان الشبكة المحلية أو العنوان العام الذي يصل إليه اللاعبون."}
        </p>
        {join.joinUrl ? (
          <>
            <div
              className="host-join-dialog__qr"
              aria-label="رمز QR لرابط انضمام اللاعب"
            >
              {join.qrDataUrl ? (
                <img alt="رمز QR لرابط انضمام اللاعب" src={join.qrDataUrl} />
              ) : join.qrError ? (
                <p role="alert">تعذر إنشاء الرمز.</p>
              ) : (
                <p role="status">جارٍ إنشاء الرمز…</p>
              )}
            </div>
            <label className="host-join-dialog__link">
              <span>رابط انضمام اللاعب</span>
              <input dir="ltr" readOnly value={join.joinUrl} />
            </label>
            <button
              className="button"
              onClick={() => void join.copyLink()}
              type="button"
            >
              انسخ رابط الانضمام
            </button>
          </>
        ) : null}
        <p aria-live="polite" className="form-message">
          {join.qrError || join.copyStatus}
        </p>
      </section>
    </dialog>
  );
}

/**
 * Converts consecutive authoritative room projections into visual-only board
 * events.  It deliberately uses no timer or intent authority: a correction,
 * cache snapshot, reconnect, content hold, or pause simply establishes a new
 * baseline and cancels any in-flight decorative effect.
 */
export function boardPresentationTransition(
  previous: ProjectionEnvelope<SafeProjection> | undefined,
  current: ProjectionEnvelope<SafeProjection> | null | undefined,
  connected: boolean,
): BoardPresentationContext | undefined {
  if (!current) return undefined;
  const projection = current.projection;
  const base: BoardPresentationContext = {
    roomId: current.roomId,
    round: projection.currentRound,
    phase: projection.room.state,
    revision: current.revision,
    eventKey: `${current.roomId}:${current.revision}:steady`,
  };
  const suppressed = !connected || current.authoritative === false || Boolean(projection.contentHold) || ["PAUSED", "CORRECTION"].includes(projection.room.state);
  const previousSuppressed = !previous || previous.authoritative === false || Boolean(previous.projection.contentHold) || ["PAUSED", "CORRECTION"].includes(previous.projection.room.state);
  if (!previous || previous.roomId !== current.roomId || current.revision <= previous.revision || suppressed || previousSuppressed)
    return { ...base, suppressEffects: true };

  const before = previous.projection;
  const event = (type: NonNullable<BoardPresentationContext["event"]>, cellId?: string, team?: TeamAxis): BoardPresentationContext => ({
    ...base,
    event: type,
    eventCellId: cellId,
    eventKey: `${current.roomId}:${current.revision}:${type}:${cellId ?? ""}:${team ?? ""}`,
    eventTeam: team,
  });
  const currentWinning = projection.winningPath?.join("|") ?? "";
  const previousWinning = before.winningPath?.join("|") ?? "";
  if (currentWinning && currentWinning !== previousWinning)
    return event("victory", projection.winningPath?.[0]);

  const wasAnswering = before.room.state === "FIRST_ANSWER" || before.room.state === "OPPONENT_CHANCE";
  const awardCellId = before.activeCellId;
  const newlyAwarded = awardCellId && !before.board?.find((cell) => cell.id === awardCellId)?.owner &&
    projection.board?.find((cell) => cell.id === awardCellId)?.owner === before.answeringTeam;
  if (wasAnswering && awardCellId && before.answeringTeam && newlyAwarded)
    return event("award", awardCellId, before.answeringTeam);

  const changedContent = projection.board?.find((cell) => {
    const prior = before.board?.find((value) => value.id === cell.id);
    return prior && (prior.revealedLetter !== cell.revealedLetter || prior.categoryLabelAr !== cell.categoryLabelAr);
  });
  if (before.room.state === "LETTER_REVEAL" && changedContent)
    return event("content", changedContent.id);
  if (before.room.state === "ROUND_SETUP" && projection.room.state === "CELL_SELECTION")
    return event("round-entry");
  if (projection.activeCellId && projection.activeCellId !== before.activeCellId)
    return event("selection", projection.activeCellId);
  if (!before.buzzWinner && projection.buzzWinner)
    return event("buzzer", undefined, projection.buzzWinner.team);
  return base;
}

function useBoardPresentationContext(
  envelope: ProjectionEnvelope<SafeProjection> | null | undefined,
  connection: string,
) {
  const previous = useRef<ProjectionEnvelope<SafeProjection> | undefined>(undefined);
  const context = useMemo(
    () => boardPresentationTransition(previous.current, envelope, connection === "connected"),
    [connection, envelope],
  );
  useEffect(() => {
    if (envelope) previous.current = envelope;
  }, [envelope]);
  return context;
}

export function huroofSoundCues(previous: ProjectionEnvelope<SafeProjection>, current: ProjectionEnvelope<SafeProjection>): SoundCue[] {
  const before = previous.projection;
  const after = current.projection;
  const phase = after.room.state;
  const priorPhase = before.room.state;
  if (current.roomId !== previous.roomId || current.revision <= previous.revision ||
      after.currentRound !== before.currentRound || [phase, priorPhase].some(state => state === "CORRECTION" || state === "PAUSED")) return [];

  const cues: SoundCue[] = [];
  const challengeResult = after.challenge && after.challenge.occurrence === before.challenge?.occurrence &&
    !before.challenge.result ? after.challenge.result : undefined;
  const cellId = before.activeCellId;
  const wasAnswering = priorPhase === "FIRST_ANSWER" || priorPhase === "OPPONENT_CHANCE";
  const claimed = cellId && (challengeResult === "correct" || wasAnswering || priorPhase === "CELL_AWARDED" || priorPhase === "PATH_CHECK") &&
    !before.board?.find(cell => cell.id === cellId)?.owner && after.board?.find(cell => cell.id === cellId)?.owner;
  const feedback = after.answerFeedback;
  const newFeedback = feedback && (feedback.expiresAt !== before.answerFeedback?.expiresAt || feedback.outcome !== before.answerFeedback.outcome);
  if (newFeedback) cues.push(feedback.outcome === "correct" ? "correct" : "wrong");
  else if (challengeResult === "correct" || (wasAnswering && (phase === "CELL_AWARDED" || claimed))) cues.push("correct");
  else if (challengeResult === "failed" || (wasAnswering && phase === "QUESTION_FAILED" && after.questionFailedReason === "incorrect")) cues.push("wrong");
  if (claimed) cues.push("cell-claimed");
  if ((after.winningPath?.length && !before.winningPath?.length) ||
      (after.matchWinner && !before.matchWinner) || (after.roundResults?.length ?? 0) > (before.roundResults?.length ?? 0)) cues.push("win");
  return cues;
}

export function RoomRoute({
  surface,
}: {
  surface: "lobby" | "host" | "play" | "display" | "results";
}) {
  const { roomCode } = useParams();
  // A same-route rematch replaces the room identity. Key the entire live route so
  // subscriptions, capabilities, and authoritative envelopes from the completed
  // room cannot render or dispatch while the new room is still loading.
  return (
    <RoomRouteInstance key={roomCode ?? "missing-room"} surface={surface} />
  );
}

function RoomRouteInstance({
  surface,
}: {
  surface: "lobby" | "host" | "play" | "display" | "results";
}) {
  useDocumentTitle(
    surface === "host"
      ? "لوحة المضيف"
      : surface === "play"
        ? "بازر اللاعب"
        : surface === "display"
          ? "شاشة الجمهور"
          : surface === "results"
            ? "نتيجة المباراة"
            : "غرفة الانتظار",
  );
  const { roomCode } = useParams();
  let roomBackend: "pg" | "legacy" | "enta" | undefined;
  try { roomBackend = parseRoomLocator(roomCode).backend; } catch { roomBackend = undefined; }
  const { envelope, connection, error, presence, send, reportError } = useRoom(
    roomCode,
    surface === "display",
    surface === "display" ? "audience" : undefined,
  );
  const boardPresentationContext = useBoardPresentationContext(envelope, connection);
  const navigate = useNavigate();
  const projection = envelope?.projection;
  const soundRole: SoundRole = surface === "display" ? "display" : envelope?.role === "host" ? "host" : "player";
  const soundProjection = connection === "connected" && envelope?.authoritative !== false && !projection?.contentHold ? envelope : null;
  useGameSoundTransition(soundRole, soundProjection, huroofSoundCues);
  const challengeClock = projection?.challenge;
  const soundClockActive = soundProjection && projection?.room.state !== "PAUSED" && projection?.room.state !== "CORRECTION" && !challengeClock?.paused;
  const soundDeadline = challengeClock ? (challengeClock.attemptsClosed ? undefined : challengeClock.deadlineAt) : projection?.deadlineAt;
  useDeadlineSound(soundRole, soundClockActive ? soundDeadline : undefined, soundClockActive ? envelope?.serverTime : undefined);
  // The legacy fixture setting still creates a real local room through the
  // route fallback. Only the adapter's own synthetic room is read-only.
  const fixtureRoom = isReadOnlyFixtureRoom(gameRuntime.kind, envelope?.roomId);
  const localRematch = useHuroofRematch(isAlmaidanLocalDevelopment ? envelope?.roomId : undefined);
  const [hostedRematchBusy, setHostedRematchBusy] = useState(false);
  const rematchBusy = localRematch.busy || hostedRematchBusy;
  const [lobbyBusy, setLobbyBusy] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [showHostAnswer, setShowHostAnswer] = useState(true);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const hostJoin = useHostJoinLink(
    envelope?.role === "host" ? (roomCode?.startsWith("M2-") ? roomCode : projection?.room.roomCode ?? "") : "",
  );
  const [draggedTeamTarget, setDraggedTeamTarget] =
    useState<AssignmentTarget>();
  const liveTeamFocusTarget = useRef<string | undefined>(undefined);
  const [buzzSubmitting, setBuzzSubmitting] = useState(false);
  const [correctionDialogOpen, setCorrectionDialogOpen] = useState(false);
  const [expandedBoardOpen, setExpandedBoardOpen] = useState(false);
  const correctionTriggerRef = useRef<HTMLButtonElement>(null);
  const expandedBoardDialogRef = useRef<HTMLDialogElement>(null);
  const expandedBoardCloseRef = useRef<HTMLButtonElement>(null);
  const expandedBoardTriggerRef = useRef<HTMLButtonElement>(null);
  const buzzSubmittingRef = useRef(false);
  const automaticHostTransitionRef = useRef<string | undefined>(undefined);
  const hostControlsRef = useRef<HTMLElement>(null);
  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const restoreExpandedBoardFocus = () => {
    setExpandedBoardOpen(false);
    window.requestAnimationFrame(() =>
      expandedBoardTriggerRef.current?.focus(),
    );
  };
  const closeExpandedBoard = () => {
    const dialog = expandedBoardDialogRef.current;
    if (dialog?.open && typeof dialog.close === "function") {
      dialog.close();
      return;
    }
    dialog?.removeAttribute("open");
    restoreExpandedBoardFocus();
  };
  useEffect(() => {
    const dialog = expandedBoardDialogRef.current;
    if (!dialog) return;
    if (expandedBoardOpen && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      queueMicrotask(() => expandedBoardCloseRef.current?.focus());
    }
    if (!expandedBoardOpen && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [expandedBoardOpen]);
  useEffect(() => {
    const key = liveTeamFocusTarget.current;
    if (!key) return;
    const target = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-target-key]"),
    ).find((element) => element.dataset.targetKey === key);
    if (target) {
      target.focus();
      liveTeamFocusTarget.current = undefined;
    }
  }, [envelope?.revision]);
  useEffect(() => {
    if (!projection) return;
    buzzSubmittingRef.current = false;
    setBuzzSubmitting(false);
  }, [envelope?.revision, projection?.self?.canBuzz]);
  useEffect(() => {
    if (surface !== "host" || envelope?.role !== "host" || !projection?.room.state ||
        projection.room.state === "CORRECTION" || expandedBoardOpen || correctionDialogOpen) return;
    const hostPrimary = hostControlsRef.current?.querySelector<HTMLElement>(
      ".host-controls__topline .button--primary:not(:disabled), .host-controls__topline .host-team-selection__button:not(:disabled)",
    );
    (hostPrimary ?? questionHeadingRef.current)?.focus({ preventScroll: true });
  }, [surface, envelope?.role, projection?.room.state, expandedBoardOpen, correctionDialogOpen]);
  // A retained challenge still requires the host's explicit continuation before the board returns.
  const finalDestination = projection?.room.state === "MATCH_COMPLETE" && !projection.challenge &&
    envelope?.authoritative !== false && roomCode && surface !== "results" && surface !== "display" &&
    (envelope?.role === "host" || envelope?.role === "player")
      ? `/room/${encodeURIComponent(roomCode)}/results`
      : undefined;
  const successor = envelope?.authoritative !== false ? projection?.room.successor : undefined;
  const followSuccessor = successor && roomCode !== successor.roomCode &&
    (surface === "display" || envelope?.role === "host" && !rematchBusy)
      ? `/room/${encodeURIComponent(successor.roomCode)}/${surface === "display" ? "display" : "lobby"}`
      : undefined;
  const activeDestination = followSuccessor ?? finalDestination ?? activeLobbyDestination(
    roomCode,
    surface,
    envelope?.role,
    projection?.room.state,
  );
  useEffect(() => {
    if (activeDestination) navigate(activeDestination, { replace: true });
  }, [activeDestination, navigate]);
  useEffect(() => {
    if (surface === "results" && projection?.room.state === "MATCH_COMPLETE" && !projection.challenge)
      resultsHeadingRef.current?.focus({ preventScroll: true });
  }, [surface, projection?.room.state, projection?.challenge]);
  const action = async (
    type: IntentType,
    payload?: Record<string, unknown>,
  ) => {
    try {
      await send(type, payload);
      reportError("");
      return true;
    } catch (reason) {
      reportError(readableError(reason));
      return false;
    }
  };
  useEffect(() => {
    const type =
      projection?.room.state === "ROUND_SETUP"
        ? "ROUND_READY"
        : projection?.room.state === "LETTER_REVEAL"
        ? "LETTER_REVEALED"
        : projection?.room.state === "CELL_AWARDED"
          ? "AWARD_CELL"
          : projection?.room.state === "PATH_CHECK"
            ? "CHECK_PATH"
            : undefined;
    const transitionKey = type ? `${envelope?.revision}:${type}` : undefined;
    if (
      !type ||
      Boolean(projection?.challenge) ||
      surface !== "host" ||
      envelope?.role !== "host" ||
      connection !== "connected" ||
      fixtureRoom ||
      automaticHostTransitionRef.current === transitionKey
    )
      return;
    automaticHostTransitionRef.current = transitionKey;
    void action(type);
  }, [
    action,
    connection,
    envelope?.revision,
    envelope?.role,
    fixtureRoom,
    projection?.room.state,
    surface,
  ]);
  const lobbyAction = async (
    type: IntentType,
    payload?: Record<string, unknown>,
  ) => {
    if (lobbyBusy || connection !== "connected" || fixtureRoom) return false;
    setLobbyBusy(true);
    try {
      return await action(type, payload);
    } finally {
      setLobbyBusy(false);
    }
  };
  const updateAudienceQuestionVisibility = async (visible: boolean) => {
    if (visibilityBusy || connection !== "connected" || fixtureRoom) return;
    setVisibilityBusy(true);
    try {
      await action("SET_AUDIENCE_QUESTION_VISIBILITY", {
        showQuestion: visible,
      });
    } finally {
      setVisibilityBusy(false);
    }
  };
  const teamAssignment =
    envelope?.role === "host" && projection
      ? {
          busy: lobbyBusy,
          draggedTarget: draggedTeamTarget,
          enabled:
            !fixtureRoom &&
            connection === "connected" &&
            canManageTeamsInState(projection.room.state),
          onAssign: (target: AssignmentTarget, team: TeamAxis) => {
            if (
              fixtureRoom ||
              connection !== "connected" ||
              !canManageTeamsInState(projection.room.state)
            )
              return;
            liveTeamFocusTarget.current = targetKey(target);
            void lobbyAction("LOBBY_ASSIGN_TEAM", { ...target, team });
          },
          onDragEnd: () => setDraggedTeamTarget(undefined),
          onDragStart: (target: AssignmentTarget) =>
            setDraggedTeamTarget(target),
          onDrop: (team: TeamAxis, target?: AssignmentTarget) => {
            if (
              fixtureRoom ||
              connection !== "connected" ||
              !canManageTeamsInState(projection.room.state)
            ) {
              setDraggedTeamTarget(undefined);
              return;
            }
            const targetMember = target || draggedTeamTarget;
            setDraggedTeamTarget(undefined);
            if (targetMember) {
              liveTeamFocusTarget.current = targetKey(targetMember);
              void lobbyAction("LOBBY_ASSIGN_TEAM", {
                ...targetMember,
                team,
              });
            }
          },
          teams: projection.room.teams ?? {
            horizontal: "الأحمر",
            vertical: "الأخضر",
          },
        }
      : undefined;
  const reconcileDeadline = async () => {
    if (roomBackend !== "legacy") return false;
    if (gameRuntime.kind !== "firebase" || !envelope) return true;
    try {
      return (await gameRuntime.syncDeadline?.(envelope.roomId))?.expired === true;
    } catch (reason) {
      reportError(readableError(reason));
      return false;
    }
  };
  const rematch = async () => {
    if (roomBackend === "pg") {
      // PG rooms still use their existing prefilled setup path.
      navigate(sameSettingsNewMatchHref(projection?.room.matchSettings));
      return;
    }
    if (isAlmaidanLocalDevelopment && envelope) {
      const failure = await localRematch.start();
      if (failure) navigate(`/huroof/rematch/${envelope.roomId}`, { state: { rematchFailure: failure } });
      return;
    }
    const settings = projection?.room.matchSettings;
    if (!settings || rematchBusy) return;
    setHostedRematchBusy(true);
    reportError("");
    try {
      const body = await gameRuntime.createRoom({
        displayName: "المضيف",
        ...settings,
        ...(gameRuntime.kind === "firebase" && envelope ? { predecessorRoomId: envelope.roomId } : {}),
      });
      if (!body.roomId || !body.roomCode)
        throw new Error("تعذر إنشاء الإعادة.");
      saveCapability(body.roomId, { token: body.token ?? "", role: "host" });
      sessionStorage.setItem(`huroof:code:${body.roomCode}`, body.roomId);
      navigate(`/room/${body.roomCode}/lobby`);
    } catch (reason) {
      reportError(readableError(reason));
    } finally {
      setHostedRematchBusy(false);
    }
  };
  const receivesFeedback = envelope?.role === "player" && envelope.authoritative !== false && connection === "connected";
  const answerFeedback = usePlayerAnswerFeedback(
    receivesFeedback ? projection?.answerFeedback : undefined,
    envelope?.serverTime,
    projection?.room.teams,
  );
  const feedback = receivesFeedback ? answerFeedback : undefined;
  if (!projection || !envelope)
    return (
      <main data-page-layout="wide"
        className="app-page spatial-shell spatial-shell--status"
        id="main-content"
      >
        <AppHeader />
        <section className="status-panel spatial-status-panel">
          <h1>
            {error || connection === "offline"
              ? "تعذر فتح الغرفة"
              : "جارٍ الاتصال بالغرفة…"}
          </h1>
          <p>
            {error || "تحقق من رابط الغرفة ثم حاول الانضمام من صفحة الدخول."}
          </p>
          {(error || connection === "offline") && roomBackend && surface !== "display" && (
            <Link className="button button--primary" to={`/room/${encodeURIComponent(roomCode ?? "")}/join`}>
              ادخل الغرفة باسمك
            </Link>
          )}
          <Link className="button" to="/">الرئيسية</Link>
        </section>
      </main>
    );
  const role = envelope.role;
  const state = projection.room.state;
  const host = role === "host";
  const audienceQuestionVisible =
    projection.room.audienceQuestionVisible !== false;
  const questionMediaVisible =
    Boolean(projection.question?.media) &&
    canRenderCurrentQuestionMedia({
      authoritative: envelope.authoritative,
      connection,
      role,
      state,
      surface,
    });
  const audienceQuestionTextVisible = audienceQuestionBandVisible(
    audienceQuestionVisible,
    state,
    projection.question?.promptAr,
  );
  const visibilityControls = host ? (
    <HostVisibilityControls
      audienceQuestionVisible={audienceQuestionVisible}
      disabled={
        fixtureRoom ||
        connection !== "connected" ||
        visibilityBusy ||
        Boolean(projection.contentHold)
      }
      readOnlyReason={
        projection.contentHold
          ? "توقف المحتوى: خيارات العرض المشتركة معلقة حتى تنهي المباراة بلا فائز أو تبدأ مباراة جديدة."
          : undefined
      }
      onAudienceQuestionChange={(visible) =>
        void updateAudienceQuestionVisibility(visible)
      }
      onHostAnswerChange={setShowHostAnswer}
      showHostAnswer={showHostAnswer}
    />
  ) : null;
  const correctionPending = state === "CORRECTION";
  const correctionDialogVisible = correctionDialogOpen || correctionPending;
  const resultState = resultRouteState(roomCode, role, state);
  const canStartMatch = canDispatchLobbyStart(state, projection.room.canStart);
  const team = projection.self?.team;
  const cells = projection.board ?? previewBoardCells;
  const incompleteEnd = Boolean(projection.endedWithoutWinner);
  const boardMotionEnabled =
    connection === "connected" && envelope.authoritative !== false;
  const boardMotionBaselineKey = `${connection}:${envelope.authoritative === false ? "cached" : "server"}`;
  const winner = matchWinner(projection);
  const victoryReason = matchReason(projection);
  const answerWindow = state === "FIRST_ANSWER" || state === "OPPONENT_CHANCE";
  const isBuzzWinner = answerWindow && projection.self?.isBuzzWinner === true;
  const otherBuzzWinner = answerWindow && projection.buzzWinner?.method === "player" && !isBuzzWinner
    ? projection.buzzWinner.displayName : undefined;
  const buzzText =
    connection === "offline"
      ? "انقطع الاتصال"
      : connection === "stale"
        ? "بانتظار تأكيد الخادم"
        : connection === "connecting" || connection === "reconnecting"
          ? "جارٍ تأكيد الاتصال"
          : projection.contentHold
            ? "توقف المحتوى"
            : projection.self?.canBuzz
              ? "اضغط الآن"
              : isBuzzWinner
                ? "أنت الأسرع — أجب"
                : state === "OPPONENT_CHANCE"
                  ? "الفرصة للفريق الآخر"
                  : "استعد";
  const playerTeam = team ?? "horizontal";
  const buzzerState = buzzSubmitting
    ? "pending"
    : connection === "offline"
      ? "offline"
      : connection === "stale"
        ? "stale"
        : connection === "connecting" || connection === "reconnecting"
          ? "reconnecting"
          : projection.self?.canBuzz
            ? "open"
            : isBuzzWinner
              ? "first"
              : "locked";
  const playerMessage = error ||
    (connection === "stale" ? "وصلت نسخة محفوظة. ننتظر تأكيد الخادم قبل فتح البازر."
      : connection !== "connected" ? "جارٍ تأكيد أحدث حالة للمباراة." : undefined) ||
    (isBuzzWinner ? "أنت الأسرع — أجب الآن" : undefined) ||
    (otherBuzzWinner ? <><bdi>{otherBuzzWinner}</bdi> أسرع — ننتظر الإجابة</> : undefined) ||
    feedback ||
    (state === "QUESTION_FAILED" && projection.questionFailedReason === "no-answer" ? noAnswerMessage : undefined) ||
    projection.messageAr ||
      (projection.contentHold
        ? "توقف اللعب لأن المحتوى المتاح لهذه الخطوة نفد. سيقرر المضيف إنهاء المباراة بلا فائز أو بدء مباراة جديدة."
        : state === "MATCH_COMPLETE"
          ? winner
            ? `المسار والمباراة اكتملَا لصالح ${winner}.`
            : "اكتملت المباراة."
          : projection.self?.canBuzz
            ? "البازر مفتوح لفريقك."
            : "سيظهر هنا وضعك التالي.");
  const lobbyGameKind = projection.room.matchSettings?.gameKind ?? "huroof";
  const lobbyCategories = projection.room.matchSettings?.categories ?? [];
  const lobbyScope =
    lobbyGameKind === "categories"
      ? `لوحة الفئات · ${lobbyCategories.length} فئات مختارة`
      : lobbyCategories.length
        ? `لوحة الحروف · ${lobbyCategories.length} فئات مختارة`
        : "لوحة الحروف · كل الفئات المتاحة";
  const invitationCode = roomBackend === "pg" && roomCode ? roomCode : projection.room.roomCode;
  const preferredJoinOrigin = host ? hostJoin.origin : import.meta.env.VITE_PUBLIC_JOIN_ORIGIN;
  const invitationOrigin = isAlmaidanLocalDevelopment
    ? window.location.origin
    : normalizedJoinOrigin(preferredJoinOrigin) ?? window.location.origin;
  const invitationUrl = new URL(`/room/${encodeURIComponent(invitationCode)}/join`, invitationOrigin).href;
  const localInvitation = !normalizedJoinOrigin(invitationOrigin);
  const submitBuzz = () => {
    if (
      buzzSubmittingRef.current ||
      !projection.self?.canBuzz ||
      connection !== "connected"
    )
      return;
    buzzSubmittingRef.current = true;
    setBuzzSubmitting(true);
    void send("BUZZ")
      .then(() => reportError(""))
      .catch((reason) => {
        buzzSubmittingRef.current = false;
        setBuzzSubmitting(false);
        reportError(readableError(reason));
      });
  };
  if (projection.challenge && surface !== "lobby")
    return (
      <ChallengeStage
        authoritative={envelope.authoritative}
        challenge={projection.challenge}
        connection={connection}
        error={error}
        labelledColours={projection.room.matchSettings?.labelledColours === true}
        members={projection.room.members}
        onIntent={action}
        onDeadline={roomBackend === "legacy" && gameRuntime.kind === "firebase" ? reconcileDeadline : undefined}
        onTerminalCorrection={() => setCorrectionDialogOpen(true)}
        role={role}
        serverTime={envelope.serverTime}
        scores={projection.questionScores}
        teams={projection.room.teams}
      />
    );
  if (surface === "lobby")
    return (
      <main data-page-layout="wide"
        className="app-page spatial-shell spatial-shell--lobby"
        id="main-content"
      >
        <AppHeader soundRole={soundRole} />
        <section className="lobby-page spatial-lobby huroof-lobby">
          <header className="lobby-title huroof-lobby__header">
            <div className="lobby-title__identity">
              <h1>غرفة الانتظار</h1>
              <p className="lobby-kind" title={lobbyCategories.join("، ")}>
                {lobbyScope}
              </p>
            </div>
            <RoomCode code={invitationCode} joinUrl={invitationUrl} />
            <div className="huroof-lobby__actions">
              {host ? <>
                <div className="huroof-lobby__action">
                <button
                  aria-describedby="huroof-start-hint"
                  className="button button--primary"
                  data-testid="start-match"
                  disabled={!canStartMatch || lobbyBusy || fixtureRoom || connection !== "connected"}
                  onClick={() => void lobbyAction("START_MATCH")}
                  type="button"
                >
                  ابدأ المباراة
                </button>
                <p data-testid="start-blocked" id="huroof-start-hint">
                  {projection.room.startBlockedReason
                    ? "وزّعوا اللاعبين على الفريقين وانتظروا جاهزية الجميع."
                    : projection.room.memberCount
                      ? "الفريقان جاهزان للبدء."
                      : "تقدرون تبدأون بدون لاعبين بالجوال وتتحكمون بالفريقين يدويًا."}
                </p>
                </div>
                {roomBackend === "legacy" && state === "LOBBY" && projection.room.canStartWithoutWaiting === true && (
                  <div className="huroof-lobby__action">
                    <button
                      aria-describedby="huroof-start-without-waiting-hint"
                      className="button"
                      disabled={lobbyBusy || fixtureRoom || connection !== "connected"}
                      onClick={() => void lobbyAction("START_MATCH", { withoutWaiting: true })}
                      type="button"
                    >
                      ابدأ بدون انتظار الباقين
                    </button>
                    <p id="huroof-start-without-waiting-hint">في كل فريق لاعب جاهز على الأقل.</p>
                  </div>
                )}
                <div className="huroof-lobby__action">
                  <Link
                    aria-describedby="huroof-display-hint"
                    className="button"
                    rel="noopener noreferrer"
                    target="_blank"
                    to={`/room/${encodeURIComponent(invitationCode)}/display`}
                  >
                    افتح شاشة العرض
                  </Link>
                  <p id="huroof-display-hint">يفتح بتبويب جديد لعرض رمز الغرفة وأسماء اللاعبين.</p>
                </div>
                <div className="huroof-lobby__action">
                  <button
                    aria-describedby="huroof-join-link-hint"
                    className="button"
                    onClick={() => isAlmaidanLocalDevelopment ? void hostJoin.copyLink() : setJoinDialogOpen(true)}
                    type="button"
                  >
                    {isAlmaidanLocalDevelopment ? "انسخ رابط الدعوة" : "رابط الدعوة"}
                  </button>
                  <p id="huroof-join-link-hint">
                    {isAlmaidanLocalDevelopment ? "افتحوا الرابط في متصفح ثاني على هالجهاز." : "انسخوا الرابط أو غيّروا عنوان الانضمام."}
                  </p>
                  {isAlmaidanLocalDevelopment && hostJoin.copyStatus && <p role="status">{hostJoin.copyStatus}</p>}
                </div>
              </> : role === "player" ? (
                <div className="huroof-lobby__action">
                  <button
                    aria-describedby="huroof-ready-hint"
                    className="button button--primary"
                    data-testid="ready"
                    disabled={lobbyBusy || connection !== "connected"}
                    onClick={() => void lobbyAction("LOBBY_SET_READY", { ready: !projection.self?.ready })}
                    type="button"
                  >
                    {projection.self?.ready ? "إلغاء الجاهزية" : "اختبر البازر وأنا جاهز"}
                  </button>
                  <p id="huroof-ready-hint">خلّوا المضيف يعرف لما تكونون جاهزين.</p>
                </div>
              ) : null}
            </div>
            {localInvitation && <p className="huroof-lobby__local-hint">رابط الانضمام المحلي يفتح على هالجهاز.</p>}
            <HuroofGuideLink className="huroof-lobby__guide" />
          </header>
          {host ? (
            <HostLobbyControls
              action={lobbyAction}
              allowRemoval={roomBackend === "legacy"}
              busy={lobbyBusy}
              canStart={canStartMatch}
              connection={connection}
              error={error}
              fixture={fixtureRoom}
              presence={presence?.players}
              room={projection.room}
              showStart={false}
            />
          ) : <>
          <div className="lobby-rosters">
            {(["horizontal", "vertical"] as const).map((axis) => {
              const members = projection.room.members?.filter((member) => member.role === "player" && member.team === axis) ?? [];
              return (
                <section className={`roster roster--${axis}`} key={axis}>
                  <h2>{teamName(projection.room.teams?.[axis])}</h2>
                  {members.length ? (
                    <ul className="huroof-lobby__players">
                      {members.map((member, index) => (
                        <li className="member-row" key={rosterKey(member, index)}>
                          <span><bdi>{member.displayName}</bdi>{projection.self && ((member.seatId && member.seatId === projection.self.seatId) || (member.uid && member.uid === projection.self.uid)) ? " (أنت)" : ""}</span>
                          <span>{member.ready ? "جاهز" : "بانتظار الجاهزية"}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p>بانتظار انضمام اللاعبين</p>}
                </section>
              );
            })}
            <section className="lobby-ready">
              <ConnectionStatus value={connection} />
              <strong>
                {projection.room.readyCount}/{projection.room.memberCount}{" "}
                جاهزون
              </strong>
            </section>
          </div>
          <p aria-live="polite" className="form-message">
            {error}
          </p>
          </>}
        </section>
          {host && !isAlmaidanLocalDevelopment && (
            <HostJoinDialog
              join={hostJoin}
              onDismiss={() => setJoinDialogOpen(false)}
              open={joinDialogOpen}
            />
        )}
      </main>
    );
  if (surface === "play") {
    const red = cells.filter((cell) => cell.owner === "horizontal").length;
    const green = cells.filter((cell) => cell.owner === "vertical").length;
    const roundScoreLabel = `${teamName(projection.room.teams?.horizontal ?? "الأحمر")} ${red}، ${teamName(projection.room.teams?.vertical ?? "الأخضر")} ${green}`;
    return (
      <main data-page-layout="wide"
        className={`player-page spatial-player player-page--${playerTeam}`}
        data-buzzer-state={buzzerState}
        data-team={playerTeam}
        id="main-content"
      >
        <a className="skip-link" href="#main-content">
          تجاوز إلى المحتوى
        </a>
        <header className="player-page__header">
          <div className="player-page__identity">
            {projection.self?.displayName && <strong><bdi>{projection.self.displayName}</bdi></strong>}
            <p className="player-page__team">
              {teamName(projection.room.teams?.[playerTeam])}{" "}
              <AxisMark axis={playerTeam} />
            </p>
          </div>
          <ConnectionStatus value={connection} />
          <p className="player-page__round-score">
            نتيجة الجولة <bdi aria-label={roundScoreLabel} dir="ltr">{red} – {green}</bdi>
          </p>
          <GameplayPreferences role="player" />
        </header>
        <section
          className="player-buzzer-zone"
          aria-describedby="player-buzzer-status"
        >
          {connection === "connected" && envelope.authoritative !== false &&
            (state === "QUESTION_READING" || answerWindow) &&
            projection.deadlineAt ? (
              <div className="player-page__countdown">
                <Countdown deadlineAt={projection.deadlineAt} serverTime={envelope.serverTime} />
              </div>
            ) : null}
          <h1 className="sr-only">
            {connection !== "connected"
              ? buzzText
              : state === "MATCH_COMPLETE"
                ? winner
                  ? `اكتملت المباراة — فاز ${winner}`
                  : "اكتملت المباراة"
                : buzzText}
          </h1>
          <button
            aria-label={
              buzzSubmitting
                ? "جارٍ إرسال الضغط"
                : state === "MATCH_COMPLETE"
                  ? "اكتملت المباراة"
                  : buzzText
            }
            className="buzzer"
            data-state={buzzerState}
            disabled={
              buzzSubmitting ||
              !projection.self?.canBuzz ||
              connection !== "connected"
            }
            onClick={submitBuzz}
            type="button"
          >
            <span className="buzzer__content" aria-hidden="true">
              <small>{stateLabel(state)}</small>
              <strong>
                {buzzSubmitting ? (
                  <>
                    جارٍ إرسال
                    <br />
                    الضغط
                  </>
                ) : connection !== "connected" ? (
                  <>
                    {connection === "offline"
                      ? "انقطع"
                      : connection === "stale"
                        ? "بانتظار تأكيد"
                        : "جارٍ تأكيد"}
                    <br />
                    الخادم
                  </>
                ) : state === "MATCH_COMPLETE" ? (
                  <>
                    اكتملت
                    <br />
                    المباراة
                  </>
                ) : projection.self?.canBuzz ? (
                  <>
                    اضغط
                    <br />
                    الآن
                  </>
                ) : isBuzzWinner ? (
                  <>
                    أنت
                    <br />
                    الأسرع
                  </>
                ) : (
                  <>
                    البازر
                    <br />
                    مغلق
                  </>
                )}
              </strong>
            </span>
          </button>
          <p
            aria-live={connection === "offline" ? "assertive" : "polite"}
            className="player-buzzer-zone__message"
            id="player-buzzer-status"
          >
            {playerMessage}
            {feedback && (isBuzzWinner || otherBuzzWinner) && <span className="player-page__feedback">{feedback}</span>}
          </p>
        </section>
        <HuroofGuideLink className="player-page__exit" />
      </main>
    );
  }
  if (surface === "display" && state === "LOBBY") {
    const players = projection.room.members?.filter((member) => member.role === "player") ?? [];
    return (
      <main className="spatial-stage game-arena huroof-waiting-display" data-page-layout="wide" data-state={state} id="main-content">
        <section aria-labelledby="huroof-display-join-title" className="huroof-waiting-display__join">
          <h1 id="huroof-display-join-title">ادخلوا من جوالاتكم</h1>
          <GameplayPreferences role="display" />
          <RoomCode code={invitationCode} joinUrl={invitationUrl} copyEnabled={false} large />
          {localInvitation && <p>رابط الانضمام المحلي يفتح على هالجهاز.</p>}
          <ConnectionStatus value={connection} />
        </section>
        <section aria-labelledby="huroof-display-players-title" className="huroof-waiting-display__roster">
          <h2 id="huroof-display-players-title">اللاعبون</h2>
          {players.length ? (
            <ul>
              {players.map((member, index) => <li key={rosterKey(member, index)}><bdi>{member.displayName}</bdi></li>)}
            </ul>
          ) : <p>بانتظار انضمام اللاعبين</p>}
        </section>
      </main>
    );
  }
  if (surface === "display")
    return (
      <main data-page-layout="wide"
        className="stage spatial-stage game-arena"
        data-state={state}
        id="main-content"
      >
        <a className="skip-link" href="#main-content">
          تجاوز إلى المحتوى
        </a>
        <div aria-hidden="true" className="game-arena__decor">
          <span className="game-arena__rail game-arena__rail--left" />
          <span className="game-arena__rail game-arena__rail--right" />
          <span className="game-arena__hex game-arena__hex--left" />
          <span className="game-arena__hex game-arena__hex--right" />
        </div>
        <header className="game-arena__header">
          <p className="game-arena__brand">
            <span>الخلية</span>
            <small>شاشة الجمهور</small>
          </p>
          <BoardStatusStrip projection={projection} serverTime={envelope.serverTime} presentationContext={boardPresentationContext} onDeadline={roomBackend === "legacy" ? reconcileDeadline : undefined} />
          <GameplayPreferences role="display" />
        </header>
        <section className="stage-game" aria-label="لوحة المباراة والنتيجة">
          <TeamScoreCard
            axis="vertical"
            currentRound={projection.currentRound}
            points={projection.questionScores?.vertical ?? 0}
            roundResults={projection.roundResults}
            rounds={projection.roundWins?.vertical ?? 0}
            teamName={projection.room.teams?.vertical}
            variant="stage"
          />
          <div className="stage-board-column">
            <GameBoard
              activeCellId={projection.activeCellId}
              cells={cells}
              className="stage-board"
              fillContainer
              presentation="tactile"
              winningPath={projection.winningPath}
              motionBaselineKey={boardMotionBaselineKey}
              motionEnabled={boardMotionEnabled}
              presentationContext={boardPresentationContext}
            />
          </div>
          <TeamScoreCard
            axis="horizontal"
            currentRound={projection.currentRound}
            points={projection.questionScores?.horizontal ?? 0}
            roundResults={projection.roundResults}
            rounds={projection.roundWins?.horizontal ?? 0}
            teamName={projection.room.teams?.horizontal}
            variant="stage"
          />
        </section>
        <section
          className={`question-band${questionMediaVisible ? " question-band--with-media" : ""}${questionMediaVisible && !audienceQuestionTextVisible ? " question-band--media-only" : ""}${!audienceQuestionTextVisible && !questionMediaVisible ? " question-band--concealed" : ""}`}
          aria-live="polite"
          style={{
            visibility: (audienceQuestionTextVisible || questionMediaVisible)
              ? "visible"
              : "hidden",
          }}
        >
          {audienceQuestionTextVisible ? <div className="question-band__heading">
            <span aria-hidden="true" className="question-band__line" />
            <svg
              aria-hidden="true"
              className="question-band__icon"
              viewBox="0 0 24 24"
            >
              <path d="M9 18h6M10 21h4M8.5 15.5C7.5 14.5 7 13.2 7 11.5a5 5 0 1 1 10 0c0 1.7-.5 3-1.5 4" />
              <path d="M9 15.5h6" />
            </svg>
            <h2>
              {state === "MATCH_COMPLETE"
                ? "نتيجة المباراة"
                : projection.question?.headerAr || "سؤال الجولة"}
            </h2>
            <span aria-hidden="true" className="question-band__line" />
          </div> : null}
          {state === "MATCH_COMPLETE" ? (
            <>
              {!incompleteEnd && <p className="question-band__eyebrow">اكتمل المسار والمباراة</p>}
              <h1>{incompleteEnd ? "انتهت المباراة بلا فائز" : winner ? `فاز ${winner}` : "انتهت المباراة"}</h1>
              {victoryReason && <p>{victoryReason}</p>}
            </>
          ) : (
            <>
              {audienceQuestionTextVisible ? <h1>
                <QuestionReadingShield state={state} team={projection.answeringTeam} deadlineAt={projection.deadlineAt} serverTime={envelope.serverTime}>
                {projection.question?.promptAr ? (
                  state === "QUESTION_READING" || state === "OPPONENT_CHANCE" ? (
                    <QuestionReveal
                      prompt={projection.question.promptAr}
                      questionKey={[
                        roomCode ?? projection.room.roomCode,
                        projection.currentRound ?? "",
                        projection.activeCellId ?? "",
                        projection.question.promptAr,
                      ].join("|")}
                    />
                  ) : (
                    projection.question.promptAr
                  )
                ) : (
                  projection.messageAr || "بانتظار السؤال"
                )}
                </QuestionReadingShield>
              </h1> : null}
              {questionMediaVisible && projection.question?.media ? (
                <CurrentQuestionMedia
                  key={`${envelope.roomId}:${projection.activeCellId ?? ""}:${projection.question.media.mediaId}:${projection.question.media.assetSha256}`}
                  roomId={envelope.roomId}
                  media={projection.question.media}
                  load={roomBackend === "pg" ? pgMediaUnavailable : undefined}
                  concealed={shouldConcealAudienceQuestionMedia(projection.question.media)}
                />
              ) : null}
              {projection.question?.revealedAnswer && shouldShowSharedRevealedAnswer() ? (
                <p className="question-band__revealed-answer" data-testid="shared-revealed-answer">
                  <b>الإجابة:</b> {projection.question.revealedAnswer}
                </p>
              ) : null}
            </>
          )}
        </section>
      </main>
    );
  if (surface === "results")
    return (
      <main data-page-layout="wide"
        className="app-page spatial-shell spatial-shell--results"
        id="main-content"
      >
        <AppHeader soundRole={soundRole} />
        <section className="results-page huroof-results">
          <div className="huroof-results__summary">
            <p className="eyebrow">
              {incompleteEnd
                ? "مباراة غير مكتملة"
                : resultState.isFinal
                  ? "النتيجة النهائية"
                  : "المباراة مستمرة"}
            </p>
            <h1 ref={resultsHeadingRef} tabIndex={-1}>
              {incompleteEnd
                ? "انتهت المباراة بلا فائز"
                : !resultState.isFinal
                  ? "لم تنته المباراة بعد"
                  : winner
                    ? `فاز ${winner}`
                    : projection.winningPath?.length
                      ? "اكتمل المسار الفائز"
                      : "نتيجة المباراة"}
            </h1>
            {!resultState.isFinal && !incompleteEnd && (
              <p>الحالة الحالية: {stateLabel(state)}</p>
            )}
            {incompleteEnd && (
              <p>
                انتهت المباراة قبل اكتمالها. احتُفظ بالنقاط وسجل الجولات
                دون إعلان فائز.
              </p>
            )}
            {victoryReason && <p>فاز {victoryReason}</p>}
            {feedback && <p role="status">{feedback}</p>}
            <div className="huroof-results__scores" aria-label="نتيجة الفريقين">
              {(["horizontal", "vertical"] as const).map((axis) => (
                <section className="huroof-results__score" data-team={axis} key={axis}>
                  <h2><Icon kind={axis === "horizontal" ? "arrows-horizontal" : "arrows-vertical"} /> <bdi>{projection.room.teams?.[axis] ?? (axis === "horizontal" ? "الأحمر" : "الأخضر")}</bdi></h2>
                  <p><strong>{projection.roundWins?.[axis] ?? 0}</strong> جولات فاز بها الفريق</p>
                  <p><strong>{projection.questionScores?.[axis] ?? 0}</strong> نقاط الإجابات</p>
                </section>
              ))}
            </div>
            {resultState.isFinal ? <nav aria-label="خيارات بعد المباراة" className="huroof-result-actions">
              {role === "player" && successor && <HuroofRematchJoin roomId={envelope.roomId} successor={successor} />}
              {host && <>
                <button className="button button--primary" data-testid="rematch-same-settings" disabled={rematchBusy} onClick={() => void rematch()} type="button">
                  {rematchBusy ? "جارٍ إنشاء الإعادة…" : "العبوا مرة ثانية"}
                </button>
                <Link className="button" to="/#game-choice-title">غيّروا اللعبة</Link>
              </>}
              <Link className={`button${host || successor ? "" : " button--primary"}`} to="/">الرئيسية</Link>
            </nav> : <Link className="button button--primary" to={resultState.returnTo ?? "/"}>
              {role === "host" ? "العودة إلى لوحة المضيف" : role === "player" ? "العودة إلى البازر" : "العودة إلى شاشة الجمهور"}
            </Link>}
            <details className="huroof-results__rules">
              <summary>قواعد احتساب النقاط</summary>
              <p>كل إجابة صحيحة تمنح الفريق خلية ونقطة. اكتمال المسار يمنح الفريق جولة.</p>
              {projection.matchRule && <p>{projection.matchRule.victoryAr}</p>}
              {projection.roundResults?.length ? <ol aria-label="نتائج الجولات">
                {projection.roundResults.map(({ round, winner: axis }) => (
                  <li key={round}>الجولة {round} · <bdi>{projection.room.teams?.[axis] ?? (axis === "horizontal" ? "الأحمر" : "الأخضر")}</bdi></li>
                ))}
              </ol> : null}
            </details>
          </div>
          <GameBoard
            cells={cells}
            className="result-board"
            presentation="tactile"
            winningPath={projection.winningPath}
            motionBaselineKey={boardMotionBaselineKey}
            motionEnabled={boardMotionEnabled}
            presentationContext={boardPresentationContext}
          />
          {error && <p aria-live="polite" className="form-message">{error}</p>}
        </section>
      </main>
    );
  return (
    <main data-page-layout="wide"
      className="app-page host-page spatial-shell spatial-shell--host game-arena game-arena--host"
      data-state={state}
      id="main-content"
    >
      {state === "LOBBY" ? <AppHeader soundRole={soundRole} /> : null}
      <h1 className="sr-only">لوحة المضيف</h1>
      <div aria-hidden="true" className="game-arena__decor">
        <span className="game-arena__rail game-arena__rail--left" />
        <span className="game-arena__rail game-arena__rail--right" />
        <span className="game-arena__hex game-arena__hex--left" />
        <span className="game-arena__hex game-arena__hex--right" />
      </div>
      <section className="host-layout">
        <div className="host-stage" aria-label="لوحة المباراة والنتيجة">
          <div className={`host-board${questionMediaVisible ? " host-board--media" : ""}`}>
            <BoardStatusStrip presentationContext={boardPresentationContext} projection={projection} readingCountdown={false} serverTime={envelope.serverTime} />
            {!questionMediaVisible && <GameBoard
              activeCellId={projection.activeCellId}
              cells={cells}
              className="host-game-board"
              onSelect={(cellId) => action("SELECT_CELL", { cellId })}
              presentation="tactile"
              selectable={
                host && state === "CELL_SELECTION" && !projection.contentHold
              }
              winningPath={projection.winningPath}
              motionBaselineKey={boardMotionBaselineKey}
              motionEnabled={boardMotionEnabled}
              presentationContext={boardPresentationContext}
            />}
            {!questionMediaVisible && projection.room.matchSettings?.gameKind === "categories" ? (
              <button
                aria-expanded={expandedBoardOpen}
                className="host-board-expand"
                data-testid="expand-category-board"
                onClick={() => setExpandedBoardOpen(true)}
                ref={expandedBoardTriggerRef}
                type="button"
              >
                تكبير اللوحة لقراءة الفئات
              </button>
            ) : null}
            <section aria-live="polite" className="host-question-band">
              <div className="host-question-band__heading">
                <span aria-hidden="true" className="question-band__line" />
                <h2 ref={questionHeadingRef} tabIndex={-1}>{projection.question?.headerAr || "سؤال الجولة"}</h2>
                <span aria-hidden="true" className="question-band__line" />
              </div>
              {state === "MATCH_COMPLETE" ? (
                <p className="host-question-band__finished" role="status">
                  {incompleteEnd
                    ? "انتهت المباراة بلا فائز. أنشئ مباراة جديدة للعب من البداية."
                    : "اكتملت المباراة. أنشئ مباراة جديدة للعب من البداية."}
                </p>
              ) : state === "CELL_SELECTION" ? (
                <p>بانتظار اختيار الخلية</p>
              ) : (
                <>
                  <h3>
                    <QuestionReadingShield state={state} team={projection.answeringTeam} deadlineAt={projection.deadlineAt} serverTime={envelope.serverTime}>
                    {projection.question?.promptAr ||
                      projection.messageAr ||
                      "بانتظار السؤال"}
                    </QuestionReadingShield>
                  </h3>
                  {questionMediaVisible && projection.question?.media ? (
                    <CurrentQuestionMedia
                      key={`${envelope.roomId}:${projection.activeCellId ?? ""}:${projection.question.media.mediaId}:${projection.question.media.assetSha256}`}
                      roomId={envelope.roomId}
                      media={projection.question.media}
                      load={roomBackend === "pg" ? pgMediaUnavailable : undefined}
                    />
                  ) : null}
                  {projection.question?.revealedAnswer ? (
                    <p className="host-question-band__revealed-answer" data-testid="shared-revealed-answer">
                      <b>الإجابة:</b> {projection.question.revealedAnswer}
                    </p>
                  ) : null}
                </>
              )}
            </section>
          </div>
        </div>
        <aside className="host-controls" ref={hostControlsRef}>
          {state === "LOBBY" ? (
            <>
              <HostLobbyControls
                action={lobbyAction}
                allowRemoval={roomBackend === "legacy"}
                busy={lobbyBusy}
                canStart={canStartMatch}
                connection={connection}
                error={error}
                fixture={fixtureRoom}
                presence={presence?.players}
                room={projection.room}
                visibilityControls={visibilityControls}
              />
            </>
          ) : (
            <>
              <section className="host-score-pair" aria-label="نتيجة الفريقين">
                <TeamScoreCard
                  assignment={teamAssignment}
                  axis="vertical"
                  currentRound={projection.currentRound}
                  points={projection.questionScores?.vertical ?? 0}
                  roundResults={projection.roundResults}
                  rounds={projection.roundWins?.vertical ?? 0}
                  teamName={projection.room.teams?.vertical}
                  testId="host-score-vertical"
                  players={
                    projection.room.members?.filter(
                      (member) =>
                        member.role === "player" && member.team === "vertical",
                    ) ?? []
                  }
                  presence={presence?.players}
                  variant="host"
                />
                <TeamScoreCard
                  assignment={teamAssignment}
                  axis="horizontal"
                  currentRound={projection.currentRound}
                  points={projection.questionScores?.horizontal ?? 0}
                  roundResults={projection.roundResults}
                  rounds={projection.roundWins?.horizontal ?? 0}
                  teamName={projection.room.teams?.horizontal}
                  testId="host-score-horizontal"
                  players={
                    projection.room.members?.filter(
                      (member) =>
                        member.role === "player" &&
                        member.team === "horizontal",
                    ) ?? []
                  }
                  presence={presence?.players}
                  variant="host"
                />
              </section>
              <div className="host-controls__topline">
                {state === "FIRST_ANSWER" && projection.buzzWinner ? (
                  <BuzzWinnerBanner winner={projection.buzzWinner} />
                ) : projection.deadlineAt ? (
                  <Countdown
                    deadlineAt={projection.deadlineAt}
                    onDeadline={roomBackend === "legacy" ? reconcileDeadline : undefined}
                    serverTime={envelope.serverTime}
                  />
                ) : null}
                {state === "FIRST_ANSWER" && projection.deadlineAt ? (
                  <div hidden>
                    <Countdown
                      deadlineAt={projection.deadlineAt}
                      onDeadline={roomBackend === "legacy" ? reconcileDeadline : undefined}
                      serverTime={envelope.serverTime}
                    />
                  </div>
                ) : null}
                <HostActions
                  action={action}
                  answeringTeam={projection.answeringTeam}
                  entitledTeam={projection.entitledTeam}
                  playerCount={
                    projection.room.members?.filter(
                      (member) =>
                        member.role === "player" &&
                        member.participation !== "manual",
                    ).length ?? 0
                  }
                  state={state}
                  timerStopped={gameRuntime.kind === "local" && Boolean(projection.question?.revealedAnswer) && !projection.buzzOpen}
                  contentHold={projection.contentHold}
                  questionFailedReason={projection.questionFailedReason}
                  prepareFailed={connection === "connected" && Boolean(error)}
                  gameKind={projection.room.matchSettings?.gameKind}
                  teams={
                    projection.room.teams ?? {
                      horizontal: "الأحمر",
                      vertical: "الأخضر",
                    }
                  }
                />
              </div>
              {projection.question?.occurrence && ["QUESTION_READING", "FIRST_ANSWER", "OPPONENT_CHANCE", "QUESTION_FAILED", "PAUSED"].includes(state) ? (
                <button
                  className="button button--quiet"
                  data-testid="shared-answer-reveal"
                  onClick={() => action("REVEAL_ANSWER", { occurrence: projection.question!.occurrence })}
                  type="button"
                >
                  إظهار الإجابة
                </button>
              ) : null}
              {shouldShowHostAnswers(showHostAnswer, projection.question) &&
                projection.question && (
                  <section className="private-question">
                    <div className="private-question__content">
                      <p className="private-question__answer">
                        <b>الإجابة:</b>{" "}
                        {projection.question.primaryAnswer || "—"}
                      </p>
                      <p className="private-question__alternatives">
                        <b>بدائل:</b>{" "}
                        {projection.question.acceptedAnswers
                          ?.filter(
                            (answer) =>
                              answer.trim() !==
                              projection.question?.primaryAnswer?.trim(),
                          )
                          .join("، ") || "—"}
                      </p>
                    </div>
                  </section>
                )}
              <CorrectionDialog
                audit={projection.audit}
                cells={cells}
                correction={projection.correction}
                error={error}
                readOnly={Boolean(projection.contentHold)}
                onBegin={(payload) => action("BEGIN_CORRECTION", payload)}
                onCancel={() => action("CANCEL_CORRECTION")}
                onConfirm={() => action("CONFIRM_CORRECTION")}
                onDismiss={() => setCorrectionDialogOpen(false)}
                open={correctionDialogVisible}
                pending={correctionPending}
                teams={
                  projection.room.teams ?? {
                    horizontal: "الأحمر",
                    vertical: "الأخضر",
                  }
                }
                triggerRef={correctionTriggerRef}
              />
              {error ? (
                <p aria-live="polite" className="form-message">
                  {error}
                </p>
              ) : null}
              <div className="host-controls__connection">
                <ConnectionStatus value={connection} />
              </div>
              <HostTeamManagementStatus state={state} />
            </>
          )}
          {host && <div className="host-controls__bottom-actions">
            <div className="room-game-navigation"><Link className="button" to="/">الرئيسية</Link>{isAlmaidanLocalDevelopment?<Link className="button" to="/history">مبارياتي</Link>:null}<GameplayPreferences role={soundRole} /></div>
            <div className="host-controls__action-row host-controls__action-row--two">
              <Link className="button" aria-label="فتح شاشة العرض في تبويب جديد" data-testid="host-display-link" rel="noopener noreferrer" target="_blank" to={`/room/${roomCode?.startsWith("M2-") ? roomCode : projection.room.roomCode}/display`}>شاشة العرض</Link>
              <button className="button" type="button" onClick={() => isAlmaidanLocalDevelopment ? void hostJoin.copyLink() : setJoinDialogOpen(true)}>{isAlmaidanLocalDevelopment ? "نسخ رابط الدعوة" : "رمز QR"}</button>
            </div>
            {state !== "LOBBY" && <div className="host-controls__action-row host-controls__action-row--three">
              <button className="button" data-testid="correction-trigger" disabled={!CORRECTABLE_STATES.includes(state as never) && state !== "CORRECTION"} ref={correctionTriggerRef} title={!CORRECTABLE_STATES.includes(state as never) && state !== "CORRECTION" ? "التصحيح متاح بين الأسئلة، بعد إغلاق السؤال الحالي أو استئناف المباراة." : undefined} type="button" onClick={() => setCorrectionDialogOpen(true)}>تصحيح</button>
              {visibilityControls}
              <HostPauseAction action={action} contentHold={Boolean(projection.contentHold)} state={state} />
            </div>}
            {state !== "MATCH_COMPLETE" && (state === "QUESTION_FAILED" || state === "PAUSED" || projection.contentHold) && (
              <EndWithoutWinnerControl action={action} />
            )}
          </div>}
        </aside>
        {host && (
          <HostJoinDialog
            join={hostJoin}
            onDismiss={() => setJoinDialogOpen(false)}
            open={joinDialogOpen}
          />
        )}
        {host && projection.room.matchSettings?.gameKind === "categories" ? (
          <dialog
            aria-modal="true"
            aria-labelledby="expanded-category-board-title"
            className="expanded-board-dialog"
            data-testid="expanded-category-board"
            onCancel={(event) => {
              event.preventDefault();
              closeExpandedBoard();
            }}
            onClose={restoreExpandedBoardFocus}
            ref={expandedBoardDialogRef}
          >
            <div className="expanded-board-dialog__surface">
              <div className="expanded-board-dialog__heading">
                <h2 id="expanded-category-board-title">لوحة الفئات المكبرة</h2>
                <button
                  aria-label="إغلاق اللوحة المكبرة"
                  className="button button--quiet"
                  onClick={closeExpandedBoard}
                  ref={expandedBoardCloseRef}
                  type="button"
                >
                  إغلاق
                </button>
              </div>
              <p>
                تظهر أسماء الفئات وأرقام الترتيب بوضوح. مرّر اللوحة أفقياً أو
                استخدم مفاتيح الأسهم للوصول إلى جميع الخلايا عندما تكون الجولة
                جاهزة.
              </p>
              <div
                aria-label="لوحة فئات قابلة للتمرير"
                className="expanded-board-dialog__board-scroll"
                tabIndex={0}
              >
                <GameBoard
                  activeCellId={projection.activeCellId}
                  cells={cells}
                  onSelect={(cellId) => {
                    void action("SELECT_CELL", { cellId }).then((accepted) => {
                      if (accepted) setExpandedBoardOpen(false);
                    });
                  }}
                  presentation="tactile"
                  selectable={
                    state === "CELL_SELECTION" && !projection.contentHold
                  }
                  winningPath={projection.winningPath}
                  motionBaselineKey={boardMotionBaselineKey}
                  motionEnabled={boardMotionEnabled}
                  presentationContext={boardPresentationContext}
                />
              </div>
            </div>
          </dialog>
        ) : null}
      </section>
    </main>
  );
}

export function CorrectionDialog({
  audit,
  cells,
  correction,
  error,
  readOnly = false,
  onBegin,
  onCancel,
  onConfirm,
  onDismiss,
  open,
  pending,
  teams,
  triggerRef,
}: {
  audit?: ViewProjection["audit"];
  cells: BoardCell[];
  correction?: SafeProjection["correction"];
  error: string;
  readOnly?: boolean;
  onBegin: (value: Record<string, unknown>) => Promise<boolean>;
  onCancel: () => Promise<boolean>;
  onConfirm: () => Promise<boolean>;
  onDismiss: () => void;
  open: boolean;
  pending: boolean;
  teams: NonNullable<SafeProjection["room"]["teams"]>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setNotice("");
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  const restoreFocus = () => {
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };
  const close = () => {
    if (pending) {
      setNotice("التصحيح قيد المراجعة. استخدم إلغاء التصحيح أو تأكيد التصحيح.");
      return;
    }
    if (typeof dialogRef.current?.close === "function")
      dialogRef.current.close();
    else dialogRef.current?.removeAttribute("open");
  };
  const settlePending = async (request: () => Promise<boolean>) => {
    const succeeded = await request();
    if (!succeeded) return;
    onDismiss();
    if (typeof dialogRef.current?.close === "function")
      dialogRef.current.close();
    else dialogRef.current?.removeAttribute("open");
    restoreFocus();
  };

  return (
    <dialog
      aria-labelledby="correction-dialog-title"
      className="correction-dialog"
      data-testid="correction-dialog"
      onCancel={(event) => {
        if (!pending) return;
        event.preventDefault();
        setNotice(
          "التصحيح قيد المراجعة. استخدم إلغاء التصحيح أو تأكيد التصحيح.",
        );
      }}
      onClose={() => {
        if (pending) return;
        onDismiss();
        restoreFocus();
      }}
      ref={dialogRef}
    >
      {open ? (
        <section className="correction-dialog__surface">
          <header className="correction-dialog__header">
            <div>
              <p>مراجعة المضيف</p>
              <h2 id="correction-dialog-title">تصحيح وسجل التدقيق</h2>
            </div>
            {!pending ? (
              <button
                aria-label="إغلاق التصحيح"
                className="correction-dialog__close"
                onClick={close}
                type="button"
              >
                ×
              </button>
            ) : null}
          </header>
          {pending ? (
            <CorrectionReview
              correction={correction}
              onCancel={() => settlePending(onCancel)}
              onConfirm={() => settlePending(onConfirm)}
              teams={teams}
            />
          ) : readOnly ? (
            <p className="form-message" role="status">
              توقف المحتوى: سجل التدقيق متاح للقراءة فقط، ولا يمكن بدء تصحيح قبل
              إنهاء المباراة بلا فائز أو إنشاء مباراة جديدة.
            </p>
          ) : (
            <CorrectionForm cells={cells} onCorrect={onBegin} teams={teams} />
          )}
          <section
            className="correction-dialog__audit"
            aria-labelledby="correction-audit-title"
          >
            <h3 id="correction-audit-title">سجل التدقيق</h3>
            {audit?.length ? (
              audit.map((entry) => (
                <p key={entry.revision}>
                  {entry.revision} · {stateLabel(entry.type)}
                </p>
              ))
            ) : (
              <p>لا توجد عمليات تصحيح مسجلة بعد.</p>
            )}
          </section>
          {error || notice ? (
            <p aria-live="polite" className="form-message">
              {error || notice}
            </p>
          ) : null}
        </section>
      ) : null}
    </dialog>
  );
}

function CorrectionForm({
  cells,
  onCorrect,
  teams,
}: {
  cells: BoardCell[];
  onCorrect: (value: Record<string, unknown>) => Promise<boolean>;
  teams: NonNullable<SafeProjection["room"]["teams"]>;
}) {
  const [cellId, setCellId] = useState("");
  const [owner, setOwner] = useState("");
  const [reason, setReason] = useState("");
  return (
    <form
      className="correction-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (cellId && reason.trim())
          void onCorrect({
            cellId,
            owner: owner || undefined,
            reason: reason.trim(),
          });
      }}
    >
      <fieldset className="correction-form__board">
        <legend>الخلية المراد تصحيحها</legend>
        <GameBoard
          activeCellId={cellId || undefined}
          allowOwnedSelection
          cells={cells}
          className="correction-form__game-board"
          onSelect={setCellId}
          presentation="tactile"
          selectable
        />
        <p aria-live="polite">
          {cellId
            ? `الخلية المحددة: ${cells.find((cell) => cell.id === cellId)?.revealedLetter ?? cells.find((cell) => cell.id === cellId)?.visibleValue}`
            : "اختر خلية من اللوحة."}
        </p>
      </fieldset>
      <fieldset className="correction-form__owners">
        <legend>المالك بعد التصحيح</legend>
        <div aria-label="المالك بعد التصحيح">
          <button
            aria-pressed={owner === ""}
            className="correction-owner correction-owner--unowned"
            data-testid="correction-owner-unowned"
            onClick={() => setOwner("")}
            type="button"
          >
            غير مملوكة
          </button>
          <button
            aria-pressed={owner === "horizontal"}
            className="correction-owner correction-owner--horizontal"
            data-testid="correction-owner-horizontal"
            onClick={() => setOwner("horizontal")}
            type="button"
          >
            {teamName(teams.horizontal)}
          </button>
          <button
            aria-pressed={owner === "vertical"}
            className="correction-owner correction-owner--vertical"
            data-testid="correction-owner-vertical"
            onClick={() => setOwner("vertical")}
            type="button"
          >
            {teamName(teams.vertical)}
          </button>
        </div>
      </fieldset>
      <label>
        سبب التصحيح
        <textarea
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <button className="button" type="submit">
        معاينة التصحيح
      </button>
    </form>
  );
}
function CorrectionReview({
  correction,
  onConfirm,
  onCancel,
  teams,
}: {
  correction?: SafeProjection["correction"];
  onConfirm: () => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  teams: NonNullable<SafeProjection["room"]["teams"]>;
}) {
  if (!correction)
    return (
      <section className="correction">
        <h2>التصحيح قيد التحضير</h2>
        <p>تُراجع التأثيرات التابعة قبل التأكيد.</p>
      </section>
    );
  const owner =
    correction.owner === "horizontal"
      ? teamName(teams.horizontal)
      : correction.owner === "vertical"
        ? teamName(teams.vertical)
        : "غير مملوكة";
  const prior =
    correction.priorOwner === "horizontal"
      ? teamName(teams.horizontal)
      : correction.priorOwner === "vertical"
        ? teamName(teams.vertical)
        : "غير مملوكة";
  return (
    <section className="correction" data-testid="correction-review">
      <h2>مراجعة التصحيح</h2>
      <p>
        الخلية: {correction.cellId} · من {prior} إلى {owner}
      </p>
      <p>السبب المطلوب: {correction.reason}</p>
      <p>
        الأثر التابع: سيُعاد احتساب المسار الفائز ونتيجة الجولة قبل حفظ التصحيح.
      </p>
      <div className="control-grid">
        <button className="button button--primary" onClick={onConfirm}>
          تأكيد التصحيح
        </button>
        <button className="button" onClick={onCancel}>
          إلغاء التصحيح
        </button>
      </div>
    </section>
  );
}

export function HowToPlayRoute() {
  useDocumentTitle("كيف تلعب");
  const staticPreview = isStaticPreviewBuild();
  return (
    <main data-page-layout="wide" className="maydan-app maydan-public-page maydan-rules-page" data-page-kind="reading" id="main-content" tabIndex={-1}>
      <AppHeader />
      <div className="page-rail game-guide">
        <header className="game-guide__intro">
          <p className="eyebrow">دليل اللعب</p>
          <h1>كيف تلعب؟</h1>
          <p>ابدأوا معاً، ثم اختاروا اللعبة وتعرّفوا على قواعدها.</p>
          <nav className="game-guide__nav" aria-label="انتقل إلى قواعد اللعبة">
            <a href="#rules-general">البداية</a>
            <a href="#rules-khaliah">الخلية</a>
            <a href="#rules-enta-sah">إنت صح</a>
            <a href="#rules-imposter">الدخيل</a>
          </nav>
        </header>

        <section className="game-guide__section" id="rules-general" aria-labelledby="rules-general-title">
          <div className="game-guide__section-heading"><p className="eyebrow">قبل اللعب</p><h2 id="rules-general-title">ابدأوا من هنا</h2><p>أربع خطوات تجمعكم في غرفة واحدة.</p></div>
          <ol className="game-guide__start-steps">
            <li><strong>اختاروا اللعبة</strong><span>تعرّفوا على الألعاب واختاروا ما يناسب جمعتكم.</span></li>
            <li><strong>جهّزوا الغرفة</strong><span>يسجّل المضيف الدخول بحساب موثّق ويختار إعدادات المباراة.</span></li>
            <li><strong>شاركوا الرمز</strong><span>ينضم الأصحاب بالرمز والاسم.</span></li>
            <li><strong>ابدأوا الجولة</strong><span>رتّبوا اللاعبين واتبعوا تعليمات اللعبة حتى النتيجة.</span></li>
          </ol>
          {isAlmaidanLocalDevelopment ? <p className="game-guide__note">إذا تلعبون على جهاز واحد، افتحوا نافذة ثانية لكل لاعب.</p> : null}
        </section>

        <section className="game-guide__section" id="rules-khaliah" aria-labelledby="rules-title">
          <div className="game-guide__section-heading game-artwork-heading">
            <div><p className="eyebrow">الخلية</p><h2 id="rules-title">كيف تلعب الخلية؟</h2><p>التقطوا الحروف ووصلوا بين طرفَي فريقكم.</p></div>
            <GameArtwork game="huroof" lazy />
          </div>
          <div className="game-guide__board-layout">
            <div>
              <ol className="game-guide__steps">
                <li><strong>اختاروا خلية</strong><span>يختار المضيف خلية من اللوح.</span></li>
                <li><strong>جرّبوا البازر</strong><span>اضغطوا «اختبر البازر وأنا جاهز» في غرفة الانتظار قبل ما يبدأ المضيف.</span></li>
                <li><strong>الخلايا المرقّمة</strong><span>في لوحة الحروف، الرقم يخفي حرفاً ينكشف لما تختارون الخلية.</span></li>
                <li><strong>استعدوا للإجابة</strong><span>يظهر السؤال ويُفتح البازر تلقائيًا.</span></li>
                <li><strong>التقطوا الخلية</strong><span>الإجابة الصحيحة تمنح الخلية للفريق.</span></li>
                <li><strong>الفرصة الثانية</strong><span>إذا أخطأ الأسرع، يقدر الفريق الثاني يجاوب قبل انتهاء وقته.</span></li>
                <li><strong>صِلوا الطرفين</strong><span>الفريق اللي يوصل طرفيه على اللوح يفوز بالجولة.</span></li>
                <li><strong>الفوز بالمباراة</strong><span>يفوز الفريق بجولتين متتاليتين أو 3 جولات بالمجموع.</span></li>
              </ol>
              <div className="game-guide__actions"><Link className="button button--primary" to="/host/new">إعداد الخلية</Link></div>
            </div>
            <figure className="game-guide__board">
              <div inert><GameBoard activeCellId="cell-2-2" cells={previewBoardCells.map((cell) => cell.id === "cell-2-2" ? { ...cell, owner: "horizontal" as const } : cell)} presentation="tactile" /></div>
              <figcaption><AxisMark axis="horizontal" /> يصل اليسار باليمين · <AxisMark axis="vertical" /> يصل الأعلى بالأسفل</figcaption>
            </figure>
          </div>
        </section>

        <section className="game-guide__section" id="rules-enta-sah" aria-labelledby="enta-rules-title">
          <div className="game-guide__section-heading game-artwork-heading">
            <div><p className="eyebrow">الأسئلة والجولات</p><h2 id="enta-rules-title">كيف تلعب إنت صح؟</h2><p>اختاروا النمط المناسب واتبعوا تعليمات كل جولة.</p></div>
            <GameArtwork game="enta" lazy />
          </div>
          <ol className="game-guide__steps game-guide__steps--grid">
            <li><strong>جهّزوا المباراة</strong><span>اختاروا النمط والفئات المتوافقة، وأدخلوا أسماء الفرق واللاعبين.</span></li>
            <li><strong>ادخلوا الغرفة</strong><span>شاركوا الرمز. يدخل الضيف باسمه، ثم يوزّعه المضيف على الفريق ومقعد اللاعب.</span></li>
            <li><strong>العبوا الجولات</strong><span>المضيف يدير المباراة، وتتابعون السؤال والنقاط على شاشة العرض والجوال. اتبعوا تعليمات النمط وأرسلوا الإجابات في الوقت المحدد إذا طلبت الجولة.</span></li>
            <li><strong>اعرضوا النتيجة</strong><span>اجمعوا النقاط عبر الجولات؛ يفوز الفريق الأعلى مجموعاً، ويُعرض التعادل عند تساوي أعلى مجموع. اعرضوا النتيجة المحفوظة بعد الجولات. الإنهاء المبكر يحتاج تأكيداً ويُظهر الجولات المتبقية.</span></li>
          </ol>
          <div className="game-guide__details">
            <details><summary>الأسئلة والأطفال</summary><p>يختار الفريق السؤال. يكشف المضيف الإجابة ويحتسب النقاط؛ لا تظهر الإجابة قبل الكشف.</p></details>
            <details><summary>القوائم والتمثيل والرسم</summary><p>يرسل اللاعب إجابته أو تخمينه من صفحة الغرفة قبل انتهاء الوقت. تظهر للمضيف ولصاحبها فقط، ويُرفض تكرار الإجابة نفسها من اللاعب في الجولة. يراجع المضيف ويحكم العناصر الصحيحة؛ الإرسال لا يمنح نقاطاً تلقائياً. في الرسم يعيّن المضيف الرسام ويرسل له المهمة الخاصة من صفحة الغرفة.</p></details>
            <details><summary>التحدّي</summary><p>تسجّل المحاولات والمساعدات وفق الدور. اللاعب الذي شاهد المهمة الخاصة لا يجيب عن هدفه.</p></details>
          </div>          <p className="game-guide__note">الأطفال: محتوى مراجع لأعمار 7–10. الفئات غير المتوافقة لا يمكن اختيارها.</p>
          {isAlmaidanLocalDevelopment ? <p className="game-guide__note">إذا تلعبون على هذا الكمبيوتر، افتحوا نافذة خاصة لكل لاعب.</p> : null}
          <div className="game-guide__actions">{isAlmaidanLocalDevelopment ? <Link className="button button--primary" to="/enta/new">اختيار لعبة إنت صح</Link> : <p role="status">إنت صح — قريباً</p>}</div>
        </section>

        <section className="game-guide__section" id="rules-imposter" aria-labelledby="imposter-rules-title">
          <div className="game-guide__section-heading game-artwork-heading">
            <div><p className="eyebrow">تلميح وخداع</p><h2 id="imposter-rules-title">كيف تلعب الدخيل؟</h2><p>الكل يعرف الكلمة… إلا واحد!</p></div>
            <GameArtwork game="imposter" lazy />
          </div>
          <ol className="game-guide__steps game-guide__steps--grid">
            <li><strong>شاهدوا السر</strong><span>يلعب من 3 إلى 8 أشخاص، والمضيف لاعب معهم، وكل لاعب بجهازه. يكشف كل لاعب سرّه لنفسه بالضغط المطوّل. يعرف الجميع الكلمة والفئة، أما الدخيل فيعرف الفئة فقط.</span></li>
            <li><strong>لمّحوا وناقشوا</strong><span>يقدّم كل لاعب تلميحاً من كلمة واحدة في دوره، على جولتين، ثم تناقشون.</span></li>
            <li><strong>صوّتوا بسرية</strong><span>صوّتوا لكشف الدخيل. إذا انكشف، يحصل على تخمين أخير للكلمة؛ يفوز إن أصاب، ويفوز أهل الكلمة إن أخطأ أو انتهى الوقت.</span></li>
          </ol>
          <div className="game-guide__actions">
            {isAlmaidanLocalDevelopment && !staticPreview ? <Link className="button button--primary" to="/host/new?kind=imposter">ابدأ الدخيل</Link> : <p role="status">الدخيل — اللعب المستضاف غير مفعّل</p>}
            <Link className="button button--secondary" to="/how-to-play/imposter">اقرأ قواعد الدخيل كاملة</Link>
          </div>
        </section>
      </div>
    </main>
  );
}

type Item = {
  id: string;
  targetLetter: string;
  headerAr: string;
  promptAr?: string;
  canonicalAnswer?: string;
  acceptedAnswers?: string[];
  difficulty?: string;
  status: string;
  categoryId?: string;
  sourceUrl?: string;
  useCount?: number;
  objectionCount?: number;
  reviewError?: string;
  readOnly?: boolean;
};
const reviewStatusLabel = (status: string) =>
  ({ draft: "مسودة", approved: "معتمد", rejected: "مرفوض" })[status] ??
  "غير محددة";
export function QuestionsRoute() {
  useDocumentTitle("إدارة الأسئلة");
  const { questionId } = useParams();
  const location = useLocation();
  const editorId =
    questionId ?? (location.pathname.endsWith("/new") ? "new" : undefined);
  const [items, setItems] = useState<Item[]>([]);
  const [letterFilter, setLetterFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [difficulty, setDifficulty] = useState("all");
  const [status, setStatus] = useState("all");
  const [sourceState, setSourceState] = useState("all");
  const [usage, setUsage] = useState("all");
  const [objections, setObjections] = useState("all");
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    void fetch("/api/admin/questions")
      .then((response) =>
        response.ok
          ? (response.json() as Promise<Item[]>)
          : Promise.reject(new Error()),
      )
      .then(setItems)
      .catch(() =>
        setLoadError("تعذر تحميل المخزون المحلي. تحقق من خدمة الإدارة."),
      );
  }, []);
  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          (!letterFilter || item.targetLetter === letterFilter) &&
          (categoryFilter === "all" || item.categoryId === categoryFilter) &&
          (difficulty === "all" || item.difficulty === difficulty) &&
          (status === "all" || item.status === status) &&
          (sourceState === "all" ||
            (sourceState === "complete"
              ? Boolean(item.sourceUrl)
              : !item.sourceUrl)) &&
          (usage === "all" ||
            (usage === "used"
              ? (item.useCount ?? 0) > 0
              : (item.useCount ?? 0) === 0)) &&
          (objections === "all" ||
            (objections === "has"
              ? (item.objectionCount ?? 0) > 0
              : (item.objectionCount ?? 0) === 0)),
      ),
    [
      categoryFilter,
      difficulty,
      items,
      letterFilter,
      objections,
      sourceState,
      status,
      usage,
    ],
  );
  return (
    <main data-page-layout="wide" className="app-page" id="main-content">
      <AppHeader />
      <section className="admin-page">
        <header className="admin-page__header">
          <div>
            <p className="admin-note">
              إدارة محلية فقط؛ مصادقة الإنتاج خارج نطاق هذه الواجهة.
            </p>
            <h1>{editorId ? "محرر السؤال" : "مخزون الأسئلة"}</h1>
          </div>
          {!editorId && (
            <Link className="button button--primary" to="/questions/new">
              مسودة جديدة
            </Link>
          )}
        </header>
        {editorId ? (
          <QuestionEditor id={editorId} />
        ) : (
          <div className="inventory-layout">
            <aside className="filter-rail">
              <label>
                الحرف
                <input
                  aria-label="الحرف"
                  maxLength={1}
                  placeholder="مثال: أ"
                  value={letterFilter}
                  onChange={(event) => setLetterFilter(event.target.value)}
                />
              </label>
              <label>
                الفئة
                <select
                  aria-label="الفئة"
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  <option value="all">كل الفئات</option>
                  {categoryCatalog.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.displayNameAr}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                الحالة
                <select
                  aria-label="حالة المراجعة"
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                >
                  <option value="all">كل الحالات</option>
                  <option value="draft">مسودة</option>
                  <option value="approved">معتمد</option>
                  <option value="rejected">مرفوض</option>
                </select>
              </label>
              <label>
                الصعوبة
                <select
                  aria-label="الصعوبة"
                  value={difficulty}
                  onChange={(event) => setDifficulty(event.target.value)}
                >
                  <option value="all">كل الصعوبات</option>
                  <option value="easy">سهل</option>
                  <option value="medium">متوسط</option>
                  <option value="hard">صعب</option>
                  <option value="سهل">سهل (قديم)</option>
                  <option value="متوسط">متوسط (قديم)</option>
                  <option value="صعب">صعب (قديم)</option>
                </select>
              </label>
              <label>
                حالة المصدر
                <select
                  aria-label="حالة المصدر"
                  value={sourceState}
                  onChange={(event) => setSourceState(event.target.value)}
                >
                  <option value="all">كل المصادر</option>
                  <option value="complete">مصدر مكتمل</option>
                  <option value="missing">مصدر ناقص</option>
                </select>
              </label>
              <label>
                عدد الاستخدام
                <select
                  aria-label="عدد الاستخدام"
                  value={usage}
                  onChange={(event) => setUsage(event.target.value)}
                >
                  <option value="all">كل الاستخدامات</option>
                  <option value="used">مستخدم</option>
                  <option value="unused">غير مستخدم</option>
                </select>
              </label>
              <label>
                الاعتراضات
                <select
                  aria-label="الاعتراضات"
                  value={objections}
                  onChange={(event) => setObjections(event.target.value)}
                >
                  <option value="all">كل الاعتراضات</option>
                  <option value="has">لديه اعتراضات</option>
                  <option value="none">بلا اعتراضات</option>
                </select>
              </label>
              <p>{categoryCatalog.length} فئة مستوردة</p>
            </aside>
            <div className="inventory-table">
              {loadError ? (
                <section
                  className="empty-state"
                  data-testid="admin-review-error"
                >
                  <h2>تعذر تحميل الأسئلة</h2>
                  <p>{loadError}</p>
                </section>
              ) : visible.length === 0 ? (
                <section className="empty-state">
                  <h2>لا توجد أسئلة مطابقة</h2>
                  <p>غيّر عوامل التصفية أو أنشئ مسودة محلية للمراجعة.</p>
                </section>
              ) : (
                <>
                  <div className="table-head">
                    <span>الحرف</span>
                    <span>العنوان</span>
                    <span>الحالة</span>
                    <span>الاستخدام / الاعتراضات</span>
                  </div>
                  {visible.slice(0, 100).map((item) => (
                    <Link
                      className="table-row"
                      key={item.id}
                      to={`/questions/${item.id}`}
                    >
                      <b>{item.targetLetter}</b>
                      <span>{item.headerAr}</span>
                      <span>{reviewStatusLabel(item.status)}</span>
                      <span>
                        {item.useCount ?? 0} / {item.objectionCount ?? 0}
                      </span>
                    </Link>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
function QuestionEditor({ id }: { id: string }) {
  const [item, setItem] = useState<Item | undefined>(
    id === "new"
      ? {
          id: "new",
          targetLetter: "",
          headerAr: "",
          status: "draft",
          difficulty: "متوسط",
        }
      : undefined,
  );
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState("");
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    if (id === "new") return;
    void fetch(`/api/admin/questions/${encodeURIComponent(id)}`)
      .then((response) =>
        response.ok
          ? (response.json() as Promise<Item>)
          : Promise.reject(new Error()),
      )
      .then(setItem)
      .catch(() => setLoadError("تعذر تحميل هذا السؤال للمراجعة."));
  }, [id]);
  const readOnly = Boolean(item?.readOnly || item?.status === "approved");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/admin/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: id === "new" ? undefined : id,
          promptAr: values.get("prompt"),
          canonicalAnswer: values.get("answer"),
          acceptedAnswers: String(values.get("alternatives") ?? "")
            .split("،")
            .filter(Boolean),
          targetLetter: values.get("letter"),
          sourceUrl: values.get("source"),
          versionNotes: note,
        }),
      });
      setSaved(
        response.ok
          ? "حُفظت كمسودة محلية؛ لا تُنشر تلقائياً."
          : "تعذر حفظ المسودة.",
      );
    } catch {
      setSaved("تعذر حفظ المسودة.");
    }
  }
  if (loadError)
    return (
      <section className="empty-state" data-testid="admin-review-error">
        <h2>تعذر تحميل السؤال</h2>
        <p>{loadError}</p>
      </section>
    );
  if (!item)
    return (
      <section className="empty-state">
        <p>جارٍ تحميل السؤال…</p>
      </section>
    );
  return (
    <form className="editor-layout" onSubmit={save}>
      <section>
        <p>
          السؤال: <bdi dir="ltr">{id === "new" ? "NEW" : id}</bdi>
        </p>
        {item.reviewError && (
          <p className="form-message" data-testid="review-error">
            خطأ مراجعة: {item.reviewError}
          </p>
        )}
        <label>
          السؤال
          <input
            defaultValue={item.promptAr ?? item.headerAr}
            disabled={readOnly}
            name="prompt"
            required
          />
        </label>
        <label>
          الإجابة الأساسية
          <input
            defaultValue={item.canonicalAnswer}
            disabled={readOnly}
            name="answer"
            required
          />
        </label>
        <label>
          بدائل الإجابة
          <input
            defaultValue={item.acceptedAnswers?.join("، ")}
            disabled={readOnly}
            name="alternatives"
          />
        </label>
        <label>
          الحرف المستهدف
          <input
            defaultValue={item.targetLetter}
            disabled={readOnly}
            maxLength={1}
            name="letter"
            required
          />
        </label>
        <label>
          الفئة
          <select
            defaultValue={item.categoryId}
            disabled={readOnly}
            name="category"
          >
            {categoryCatalog.map((category) => (
              <option key={category.id} value={category.id}>
                {category.displayNameAr}
              </option>
            ))}
          </select>
        </label>
        <label>
          الصعوبة
          <select
            defaultValue={item.difficulty ?? "متوسط"}
            disabled={readOnly}
            name="difficulty"
          >
            <option>متوسط</option>
            <option>سهل</option>
            <option>صعب</option>
          </select>
        </label>
        <label>
          المصدر / الرابط
          <input
            defaultValue={item.sourceUrl}
            disabled={readOnly}
            name="source"
            required
            type="url"
          />
        </label>
      </section>
      <aside>
        <h2>المراجعة والدليل</h2>
        {readOnly ? (
          <p data-testid="read-only-question">
            هذا السؤال معتمد للقراءة فقط؛ أنشئ مسودة محلية لتغييره.
          </p>
        ) : (
          <>
            <p>
              لا تنشر الأسئلة المولدة أو المسودات بلا مراجعة بشرية ومصدر مكتمل.
            </p>
            <label>
              ملاحظات الإصدار
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <button className="button button--primary" type="submit">
              احفظ كمسودة محلية
            </button>
          </>
        )}
        <p aria-live="polite">{saved || "المسودة غير منشورة."}</p>
      </aside>
    </form>
  );
}
export function NotFoundRoute() {
  useDocumentTitle("الصفحة غير موجودة");
  return (
    <StatusPage title="الصفحة غير موجودة" illustration={<StatusArt art="cloud" />} action={<StatusHomeLink />}>
      <p>يمكن تغيّر الرابط أو انتهت الجلسة.</p>
    </StatusPage>
  );
}




