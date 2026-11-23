#if defined(PRO273_INSTALLER_ROOT)
#if !defined(_WIN32)
#error PRO273 installer root is Windows-only
#endif
#include <windows.h>
#include <aclapi.h>
#include <sddl.h>
#include <bcrypt.h>
#include <psapi.h>
#include <cstdint>
#include <cstddef>
#include <cstring>
#include <cwchar>

// These low-level observations are not qualification or authorization. They
// are deliberately unreachable from the service entry until the independent
// consumed-start receipt, funding, and loader trust chain are implemented.
namespace {
constexpr wchar_t kService[] = L"HuroofWaOloofInstallerRoot-PRO311-LOCAL-20261028";
constexpr wchar_t kParameters[] = L"SYSTEM\\CurrentControlSet\\Services\\HuroofWaOloofInstallerRoot-PRO311-LOCAL-20261028\\Parameters";

// Rejection ceilings, not a resource reservation or authority to inspect.
struct Anchor {
  DWORD schema, enabled;
  ULONGLONG epoch, floor, generation, valid_from, valid_until;
  wchar_t service_sid[192], reservation[121];
  BYTE host[16], boot[16], public_key[32], key_hash[32], manifest[32],
       source[32], receiver[32], qualification[32];
};
struct AnchorField { const wchar_t* name; DWORD type; void* output; DWORD capacity; };

static bool v2_sha256(const unsigned char* data, size_t n, unsigned char out[32]);

// The expected snapshot and clock must come from the independently qualified
// installer. Matching them does not establish custody of the registry key.
bool anchor_matches_authority(const Anchor& value, const Anchor& expected, ULONGLONG now) {
  if (value.schema != 1 || value.enabled != 1 || expected.schema != 1 || expected.enabled != 1 ||
      !value.epoch || !value.floor || value.epoch < value.floor || !value.generation ||
      value.epoch != expected.epoch || value.floor != expected.floor || value.generation != expected.generation ||
      value.valid_from != expected.valid_from || value.valid_until != expected.valid_until ||
      now < value.valid_from || now >= value.valid_until) return false;
  if (std::memcmp(value.service_sid, expected.service_sid, sizeof(value.service_sid)) ||
      std::memcmp(value.reservation, expected.reservation, sizeof(value.reservation)) ||
      std::memcmp(value.host, expected.host, sizeof(value.host)) ||
      std::memcmp(value.boot, expected.boot, sizeof(value.boot)) ||
      std::memcmp(value.manifest, expected.manifest, sizeof(value.manifest)) ||
      std::memcmp(value.source, expected.source, sizeof(value.source)) ||
      std::memcmp(value.receiver, expected.receiver, sizeof(value.receiver)) ||
      std::memcmp(value.qualification, expected.qualification, sizeof(value.qualification))) return false;
  BYTE actual_hash[32]{};
  return v2_sha256(value.public_key, sizeof(value.public_key), actual_hash) &&
      std::memcmp(actual_hash, value.key_hash, sizeof(actual_hash)) == 0 &&
      std::memcmp(actual_hash, expected.key_hash, sizeof(actual_hash)) == 0;
}

// Reads a closed snapshot from an already opened HKLM64 key. The caller must
// separately secure the key and its ancestors and compare a fresh snapshot
// before each use. No snapshot authorizes startup.
[[maybe_unused]] bool read_anchor(HKEY key, const Anchor& expected, ULONGLONG now, Anchor* out) {
  if (!key || !out) return false;
  Anchor value{};
  AnchorField fields[] = {
    {L"SchemaVersion", REG_DWORD, &value.schema, sizeof(value.schema)},
    {L"Enabled", REG_DWORD, &value.enabled, sizeof(value.enabled)},
    {L"AuthorityEpoch", REG_QWORD, &value.epoch, sizeof(value.epoch)},
    {L"RevocationFloor", REG_QWORD, &value.floor, sizeof(value.floor)},
    {L"InstallationGeneration", REG_QWORD, &value.generation, sizeof(value.generation)},
    {L"ValidFromUnixMillis", REG_QWORD, &value.valid_from, sizeof(value.valid_from)},
    {L"ValidUntilUnixMillis", REG_QWORD, &value.valid_until, sizeof(value.valid_until)},
    {L"ServiceSid", REG_SZ, value.service_sid, sizeof(value.service_sid)},
    {L"StartupReservationId", REG_SZ, value.reservation, sizeof(value.reservation)},
    {L"HostIdentity", REG_BINARY, value.host, sizeof(value.host)},
    {L"BootIdentity", REG_BINARY, value.boot, sizeof(value.boot)},
    {L"AuthorityPublicKey", REG_BINARY, value.public_key, sizeof(value.public_key)},
    {L"AuthorityKeySha256", REG_BINARY, value.key_hash, sizeof(value.key_hash)},
    {L"InstallationManifestSha256", REG_BINARY, value.manifest, sizeof(value.manifest)},
    {L"SourceClosureSha256", REG_BINARY, value.source, sizeof(value.source)},
    {L"ReceiverClosureSha256", REG_BINARY, value.receiver, sizeof(value.receiver)},
    {L"StartupQualificationSha256", REG_BINARY, value.qualification, sizeof(value.qualification)}
  };
  constexpr DWORD count = sizeof(fields) / sizeof(fields[0]);
  DWORD subkeys = 0, values = 0;
  if (RegQueryInfoKeyW(key, nullptr, nullptr, nullptr, &subkeys, nullptr, nullptr,
                       &values, nullptr, nullptr, nullptr, nullptr) != ERROR_SUCCESS ||
      subkeys != 0 || values != count) return false;
  bool seen[count]{};
  for (DWORD i = 0; i < count; ++i) {
    wchar_t name[128]; DWORD chars = 128, type = 0;
    if (RegEnumValueW(key, i, name, &chars, nullptr, &type, nullptr, nullptr) != ERROR_SUCCESS)
      return false;
    DWORD j = 0;
    while (j < count && std::wcscmp(name, fields[j].name) != 0) ++j;
    if (j == count || seen[j] || type != fields[j].type) return false;
    seen[j] = true;
    DWORD bytes = fields[j].capacity, actual_type = 0;
    if (RegQueryValueExW(key, fields[j].name, nullptr, &actual_type,
          static_cast<BYTE*>(fields[j].output), &bytes) != ERROR_SUCCESS || actual_type != type)
      return false;
    if (type != REG_SZ) { if (bytes != fields[j].capacity) return false; }
    else {
      if (bytes < 2 * sizeof(wchar_t) || bytes > fields[j].capacity || bytes % sizeof(wchar_t)) return false;
      const auto* s = static_cast<const wchar_t*>(fields[j].output);
      const DWORD units = bytes / sizeof(wchar_t);
      if (s[units - 1] != L'\0') return false;
      for (DWORD k = 0; k + 1 < units; ++k) if (s[k] == L'\0') return false;
    }
  }
  for (const wchar_t* p = value.reservation; *p; ++p)
    if (!((*p >= L'A' && *p <= L'Z') || (*p >= L'a' && *p <= L'z') ||
          (*p >= L'0' && *p <= L'9') || *p == L'_' || *p == L'-')) return false;
  if (!anchor_matches_authority(value, expected, now)) return false;
  *out = value;
  return true;
}

// Fixed-buffer decoding of the authenticated holder's vector only. The caller
// must authenticate the containing immutable record and retain its bytes. This
// helper is not a funding verdict, startup authority, or service entry path.
struct StartupVector {
  uint64_t reserved_backend, reserved_shared, reserved_temporary;
  uint64_t max_input, max_output, max_allocation, stack, parent;
  uint64_t max_processes, max_backends, max_launches, max_events;
  uint64_t backend_process, qualifier_runtime, launcher_supervisor, retained_parent;
  uint64_t driver_ipc, evidence_serialization, parser_cache, rollback_cleanup, shared_runtime;
};
static bool startup_decimal(const char* text, size_t length, bool positive, uint64_t* result) {
  if (!text || !result || !length || length > 20 || (length > 1 && text[0] == '0')) return false;
  uint64_t value = 0;
  for (size_t i = 0; i < length; ++i) {
    if (text[i] < '0' || text[i] > '9') return false;
    unsigned digit = static_cast<unsigned>(text[i] - '0');
    if (value > (UINT64_MAX - digit) / 10) return false;
    value = value * 10 + digit;
  }
  if (positive && !value) return false;
  *result = value;
  return true;
}
static bool startup_sum(uint64_t* total, uint64_t value) {
  if (*total > UINT64_MAX - value) return false;
  *total += value;
  return true;
}
// Canonical JSON has sorted ASCII keys, no whitespace or escapes. Requiring
// the entire closed object in this order rejects duplicates and unknown keys.
[[maybe_unused]] bool decode_startup_vector(const char* bytes, size_t length, StartupVector* out) {
  if (!bytes || !out || !length || length > 65536) return false;
  StartupVector v{};
  struct Entry { const char* key; uint64_t* value; bool positive; };
  Entry entries[] = {
    {"backendProcessBytes", &v.backend_process, false},
    {"driverSocketIpcBytes", &v.driver_ipc, false},
    {"inputEvidenceSerializationBytes", &v.evidence_serialization, false},
    {"launcherSupervisorBytes", &v.launcher_supervisor, false},
    {"maxAllocationBytes", &v.max_allocation, true},
    {"maxBackendCount", &v.max_backends, true},
    {"maxEvents", &v.max_events, true},
    {"maxInputBytes", &v.max_input, true},
    {"maxLaunchAttempts", &v.max_launches, true},
    {"maxOutputBytes", &v.max_output, true},
    {"maxProcessCount", &v.max_processes, true},
    {"parentBytes", &v.parent, true},
    {"primitiveParserCacheBytes", &v.parser_cache, false},
    {"qualifierRuntimeBytes", &v.qualifier_runtime, false},
    {"reservedBackendBytes", &v.reserved_backend, true},
    {"reservedSharedBytes", &v.reserved_shared, true},
    {"reservedTemporaryBytes", &v.reserved_temporary, true},
    {"retainedParentBytes", &v.retained_parent, false},
    {"rollbackCleanupBytes", &v.rollback_cleanup, false},
    {"sharedRuntimeBytes", &v.shared_runtime, false},
    {"stackBytes", &v.stack, true}
  };
  size_t at = 0;
  if (bytes[at++] != '{') return false;
  for (size_t i = 0; i < sizeof(entries) / sizeof(entries[0]); ++i) {
    if (i && (at >= length || bytes[at++] != ',')) return false;
    if (at >= length || bytes[at++] != '"') return false;
    const size_t key_length = std::strlen(entries[i].key);
    if (key_length > length - at || std::memcmp(bytes + at, entries[i].key, key_length)) return false;
    at += key_length;
    if (length - at < 3 || bytes[at++] != '"' || bytes[at++] != ':' || bytes[at++] != '"') return false;
    size_t start = at;
    while (at < length && bytes[at] != '"') ++at;
    if (at >= length || !startup_decimal(bytes + start, at - start, entries[i].positive, entries[i].value)) return false;
    ++at;
  }
  if (at >= length || bytes[at++] != '}' || at != length) return false;
  uint64_t backend = 0, shared = v.shared_runtime;
  if (!startup_sum(&backend, v.backend_process) || !startup_sum(&backend, v.qualifier_runtime) ||
      !startup_sum(&backend, v.launcher_supervisor) || !startup_sum(&backend, v.retained_parent) ||
      !startup_sum(&backend, v.driver_ipc) || !startup_sum(&backend, v.evidence_serialization) ||
      !startup_sum(&backend, v.parser_cache) || !startup_sum(&backend, v.rollback_cleanup) ||
      !startup_sum(&shared, v.reserved_temporary) || v.reserved_backend < backend ||
      v.reserved_shared < shared || v.parent > v.retained_parent ||
      v.max_allocation > v.reserved_backend || v.stack > v.reserved_backend ||
      v.max_processes < 3 || v.max_launches < 3 || v.max_events < 3) return false;
  *out = v;
  return true;
}
// Views refer to immutable authenticated input retained by the caller. These
// routines check structure only; they neither authenticate nor authorize it.
struct StartupSlice { const char* data; size_t size; };
struct StartupAttempt {
  StartupSlice charge_binding, charge_key, charge_kind, event, fence, holder,
               id, parent, prepayment;
};
static bool startup_equal(StartupSlice a, StartupSlice b) {
  return a.data && b.data && a.size == b.size && std::memcmp(a.data, b.data, a.size) == 0;
}
static bool startup_id(StartupSlice s) {
  if (!s.data || !s.size || s.size > 120) return false;
  for (size_t i = 0; i < s.size; ++i) {
    const char c = s.data[i];
    if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
          (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
  }
  return true;
}
static bool startup_hash(StartupSlice s) {
  if (!s.data || s.size != 64) return false;
  for (size_t i = 0; i < s.size; ++i)
    if (!((s.data[i] >= '0' && s.data[i] <= '9') ||
          (s.data[i] >= 'a' && s.data[i] <= 'f'))) return false;
  return true;
}
// Canonical sorted ASCII keys and unescaped ASCII string values: exact
// consumption rejects missing, duplicate, unknown and out-of-order keys.
[[maybe_unused]] bool decode_startup_attempt(const char* bytes, size_t length, StartupAttempt* out) {
  if (!bytes || !out || !length || length > 65536) return false;
  StartupAttempt v{}; StartupSlice ordinal{};
  struct Entry { const char* key; StartupSlice* value; };
  Entry entries[] = {
    {"chargeBindingHash", &v.charge_binding}, {"chargeEventKey", &v.charge_key},
    {"chargeKind", &v.charge_kind}, {"eventId", &v.event}, {"fenceId", &v.fence},
    {"holderReservationId", &v.holder}, {"id", &v.id}, {"ordinal", &ordinal},
    {"parentId", &v.parent}, {"prepaymentReceiptHash", &v.prepayment}
  };
  size_t at = 0;
  if (bytes[at++] != '{') return false;
  for (size_t i = 0; i < sizeof(entries) / sizeof(entries[0]); ++i) {
    if (i && (at >= length || bytes[at++] != ',')) return false;
    if (at >= length || bytes[at++] != '"') return false;
    const size_t n = std::strlen(entries[i].key);
    if (n > length - at || std::memcmp(bytes + at, entries[i].key, n)) return false;
    at += n;
    if (length - at < 3 || bytes[at++] != '"' || bytes[at++] != ':' || bytes[at++] != '"') return false;
    const size_t start = at;
    while (at < length && bytes[at] != '"') ++at;
    if (at >= length) return false;
    *entries[i].value = {bytes + start, at - start};
    ++at;
  }
  if (at >= length || bytes[at++] != '}' || at != length ||
      ordinal.size != 1 || ordinal.data[0] != '1' ||
      !startup_hash(v.charge_binding) || !startup_hash(v.prepayment) ||
      !startup_id(v.charge_key) || !startup_id(v.charge_kind) || !startup_id(v.event) ||
      !startup_id(v.fence) || !startup_id(v.holder) || !startup_id(v.id) || !startup_id(v.parent)) return false;
  *out = v;
  return true;
}
[[maybe_unused]] bool join_startup_attempts(const StartupAttempt (&attempts)[3],
                                            StartupSlice holder, StartupSlice prepayment) {
  if (!startup_id(holder) || !startup_hash(prepayment)) return false;
  StartupSlice identities[10] = {holder, attempts[0].id, attempts[0].event, attempts[0].fence,
    attempts[1].id, attempts[1].event, attempts[1].fence,
    attempts[2].id, attempts[2].event, attempts[2].fence};
  for (size_t i = 0; i < 10; ++i)
    for (size_t j = 0; j < i; ++j) if (startup_equal(identities[i], identities[j])) return false;
  for (size_t i = 0; i < 3; ++i) {
    if (!startup_equal(attempts[i].holder, holder) ||
        !startup_equal(attempts[i].prepayment, prepayment) ||
        !startup_equal(attempts[i].parent, i ? attempts[i - 1].id : holder)) return false;
    for (size_t j = 0; j < i; ++j)
      if (startup_equal(attempts[i].charge_kind, attempts[j].charge_kind) &&
          startup_equal(attempts[i].charge_key, attempts[j].charge_key)) return false;
  }
  return true;
}
// Closed canonical-object reader. Slices borrow the caller's immutable bytes;
// the caller must retain those bytes, unchanged, for the lifetime of the views.
struct StartupField { const char* name; StartupSlice value; bool object; };
static bool startup_object(StartupSlice input, StartupField* fields, size_t count) {
  if (!input.data || !input.size || input.size > 65536 || input.data[0] != '{') return false;
  size_t at = 1;
  for (size_t i = 0; i < count; ++i) {
    if (i && (at >= input.size || input.data[at++] != ',')) return false;
    const size_t n = std::strlen(fields[i].name);
    if (at >= input.size || input.data[at++] != '"' || n > input.size - at ||
        std::memcmp(input.data + at, fields[i].name, n)) return false;
    at += n;
    if (input.size - at < 2 || input.data[at++] != '"' || input.data[at++] != ':') return false;
    if (fields[i].object) {
      if (at >= input.size || input.data[at] != '{') return false;
      const size_t start = at; size_t depth = 0; bool quoted = false;
      do {
        const char c = input.data[at++];
        if (c == '\\' || static_cast<unsigned char>(c) < 0x20 || static_cast<unsigned char>(c) > 0x7e) return false;
        if (c == '"') quoted = !quoted;
        else if (!quoted && c == '{') { if (++depth > 6) return false; }
        else if (!quoted && c == '}') --depth;
      } while (at < input.size && depth);
      if (depth || quoted) return false;
      fields[i].value = {input.data + start, at - start};
    } else {
      if (at >= input.size || input.data[at++] != '"') return false;
      const size_t start = at;
      while (at < input.size && input.data[at] != '"') {
        const unsigned char c = static_cast<unsigned char>(input.data[at++]);
        if (c < 0x20 || c > 0x7e || c == '\\') return false;
      }
      if (at >= input.size) return false;
      fields[i].value = {input.data + start, at - start}; ++at;
    }
  }
  return at < input.size && input.data[at++] == '}' && at == input.size;
}
static bool startup_literal(StartupSlice s, const char* literal) {
  const size_t n = std::strlen(literal);
  return s.data && s.size == n && !std::memcmp(s.data, literal, n);
}
static bool startup_hex(StartupSlice s, size_t length) {
  if (!s.data || s.size != length) return false;
  for (size_t i = 0; i < length; ++i)
    if (!((s.data[i] >= '0' && s.data[i] <= '9') || (s.data[i] >= 'a' && s.data[i] <= 'f'))) return false;
  return true;
}
static bool startup_time(StartupSlice s) {
  if (!s.data || s.size != 24) return false;
  for (size_t i = 0; i < 24; ++i) {
    const char expected = i == 4 || i == 7 ? '-' : i == 10 ? 'T' :
      i == 13 || i == 16 ? ':' : i == 19 ? '.' : i == 23 ? 'Z' : 0;
    if (expected ? s.data[i] != expected : s.data[i] < '0' || s.data[i] > '9') return false;
  }
  auto number = [&](size_t at, size_t n) { unsigned x = 0; while (n--) x = x * 10 + (s.data[at++] - '0'); return x; };
  const unsigned y = number(0,4), m = number(5,2), d = number(8,2);
  const unsigned days[] = {0,31,28,31,30,31,30,31,31,30,31,30,31};
  if (!y || !m || m > 12 || !d) return false;
  const unsigned leap = m == 2 && y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
  return d <= days[m] + leap && number(11,2) < 24 && number(14,2) < 60 && number(17,2) < 60;
}
static bool startup_sid(StartupSlice s) {
  const char prefix[] = "S-1-5-80-";
  if (!s.data || s.size <= sizeof(prefix)-1 || std::memcmp(s.data, prefix, sizeof(prefix)-1)) return false;
  size_t at = sizeof(prefix)-1;
  for (unsigned i = 0; i < 5; ++i) {
    const size_t start = at;
    while (at < s.size && s.data[at] != '-') ++at;
    uint64_t n = 0;
    if (!startup_decimal(s.data + start, at - start, false, &n) || n > UINT32_MAX) return false;
    if (i < 4) { if (at >= s.size || s.data[at++] != '-') return false; }
  }
  return at == s.size;
}
struct StartupLimits { uint64_t values[14]; };
[[maybe_unused]] bool decode_startup_limits(StartupSlice input, StartupLimits* out) {
  if (!out) return false;
  StartupField f[] = {{"maxChannelFrameBytes"},{"maxChannelFrames"},{"maxDependencies"},
    {"maxDiagnosticBytes"},{"maxElapsedMillis"},{"maxHandles"},{"maxManifestBytes"},
    {"maxManifestEntries"},{"maxPermitBytes"},{"maxRegistryValueBytes"},
    {"maxSecurityDescriptorBytes"},{"maxTokenGroups"},{"maxTokenPrivileges"},{"maxWorkspaceBytes"}};
  StartupLimits v{};
  if (!startup_object(input, f, 14)) return false;
  for (size_t i = 0; i < 14; ++i)
    if (!startup_decimal(f[i].value.data, f[i].value.size, true, &v.values[i])) return false;
  if (v.values[1] < 6) return false;
  *out = v; return true;
}
struct StartupHolder {
  StartupSlice reservation, record_hash, prepayment, physical, proof, partition, source, installation, from, until;
  StartupVector vector;
};
static bool decode_startup_holder(StartupSlice input, StartupHolder* out) {
  if (!out) return false;
  StartupField f[] = {{"installationClosureHash"},{"partitionId"},{"partitionKind"},{"physicalIdentity"},
    {"physicalProofIdentity"},{"prepaymentReceiptHash"},{"reservationId"},{"reservationRecordHash"},
    {"sourceClosureHash"},{"validFrom"},{"validUntil"},{"vector",{},true}};
  if (!startup_object(input, f, 12) || !startup_hash(f[0].value) || !startup_id(f[1].value) ||
      !startup_literal(f[2].value,"NON_QUALIFIER_BASELINE") || !startup_id(f[3].value) ||
      !startup_id(f[4].value) || !startup_hash(f[5].value) || !startup_id(f[6].value) ||
      !startup_hash(f[7].value) || !startup_hash(f[8].value) || !startup_time(f[9].value) ||
      !startup_time(f[10].value) || std::memcmp(f[9].value.data, f[10].value.data, 24) >= 0) return false;
  StartupHolder v{f[6].value,f[7].value,f[5].value,f[3].value,f[4].value,f[1].value,
    f[8].value,f[0].value,f[9].value,f[10].value,{}};
  if (!decode_startup_vector(f[11].value.data, f[11].value.size, &v.vector)) return false;
  *out = v; return true;
}
struct StartupQualification {
  StartupSlice id, host, boot, service_sid, source, installation, receiver, from, until;
  StartupSlice launcher, node, psql, loader, fence;
  uint64_t epoch, generation;
  StartupHolder holder; StartupAttempt attempts[3]; StartupLimits limits;
};
[[maybe_unused]] bool decode_startup_qualification(StartupSlice input, StartupQualification* out) {
  if (!out) return false;
  StartupField f[] = {{"authorityEpoch"},{"bootIdentity"},{"fenceQualificationHash"},
    {"holder",{},true},{"hostIdentity"},{"installationClosureHash"},{"installationGeneration"},
    {"launcherManifestHash"},{"limits",{},true},{"loaderQualificationHash"},{"nodeLaunch",{},true},
    {"nodeManifestHash"},{"psqlAttempt",{},true},{"psqlManifestHash"},{"qualificationId"},
    {"receiverClosureHash"},{"schemaVersion"},{"serviceIdentity",{},true},{"serviceStart",{},true},
    {"sourceClosureHash"},{"validFrom"},{"validUntil"}};
  if (!startup_object(input,f,22)) return false;
  StartupQualification v{};
  if (!startup_decimal(f[0].value.data,f[0].value.size,true,&v.epoch) || !startup_hex(f[1].value,32) ||
      !startup_hash(f[2].value) || !decode_startup_holder(f[3].value,&v.holder) || !startup_hex(f[4].value,32) ||
      !startup_hash(f[5].value) || !startup_decimal(f[6].value.data,f[6].value.size,true,&v.generation) ||
      !startup_hash(f[7].value) || !decode_startup_limits(f[8].value,&v.limits) || !startup_hash(f[9].value) ||
      !startup_hash(f[11].value) || !startup_hash(f[13].value) || !startup_id(f[14].value) ||
      !startup_hash(f[15].value) || !startup_literal(f[16].value,"pro273-installer-startup-qualification-v1") ||
      !startup_hash(f[19].value) || !startup_time(f[20].value) || !startup_time(f[21].value) ||
      std::memcmp(f[20].value.data,f[21].value.data,24) >= 0) return false;
  StartupField service[] = {{"serviceName"},{"serviceSid"}};
  if (!startup_object(f[17].value,service,2) ||
      !startup_literal(service[0].value,"HuroofWaOloofInstallerRoot-PRO311-LOCAL-20261028") || !startup_sid(service[1].value) ||
      !decode_startup_attempt(f[18].value.data,f[18].value.size,&v.attempts[0]) ||
      !decode_startup_attempt(f[10].value.data,f[10].value.size,&v.attempts[1]) ||
      !decode_startup_attempt(f[12].value.data,f[12].value.size,&v.attempts[2]) ||
      !join_startup_attempts(v.attempts,v.holder.reservation,v.holder.prepayment) ||
      !startup_equal(v.holder.source,f[19].value) || !startup_equal(v.holder.installation,f[5].value) ||
      std::memcmp(v.holder.from.data,f[20].value.data,24) > 0 ||
      std::memcmp(v.holder.until.data,f[21].value.data,24) < 0) return false;
  v.id=f[14].value; v.host=f[4].value; v.boot=f[1].value; v.service_sid=service[1].value;
  v.source=f[19].value; v.installation=f[5].value; v.receiver=f[15].value;
  v.from=f[20].value; v.until=f[21].value; v.launcher=f[7].value; v.node=f[11].value;
  v.psql=f[13].value; v.loader=f[9].value; v.fence=f[2].value;
  *out=v; return true;
}
// Own the backing bytes for all nested borrowed views. A capture is single-use
// even on failure, and cannot be copied or moved while any view exists.
class StartupQualificationCapture {
 public:
  StartupQualificationCapture() = default;
  StartupQualificationCapture(const StartupQualificationCapture&) = delete;
  StartupQualificationCapture& operator=(const StartupQualificationCapture&) = delete;
  bool capture(const char* input, size_t length) {
    if (used_) return false;
    used_ = true;
    if (!input || !length || length > sizeof(bytes_)) return false;
    std::memcpy(bytes_, input, length);
    length_ = length;
    valid_ = decode_startup_qualification({bytes_,length}, &value_);
    return valid_;
  }
  const StartupQualification* value() const { return valid_ ? &value_ : nullptr; }
  StartupSlice bytes() const { return valid_ ? StartupSlice{bytes_,length_} : StartupSlice{}; }
 private:
  char bytes_[65536]{};
  StartupQualification value_{};
  size_t length_ = 0;
  bool used_ = false, valid_ = false;
};
static bool startup_hex_bytes(StartupSlice text, const BYTE* bytes, size_t length) {
  if (!bytes || !startup_hex(text, length * 2)) return false;
  const char digits[] = "0123456789abcdef";
  for (size_t i = 0; i < length; ++i)
    if (text.data[2*i] != digits[bytes[i] >> 4] || text.data[2*i+1] != digits[bytes[i] & 15]) return false;
  return true;
}
static bool startup_wide_equal(StartupSlice text, const wchar_t* wide, size_t capacity) {
  if (!text.data || !wide || text.size >= capacity) return false;
  for (size_t i = 0; i < text.size; ++i)
    if (wide[i] != static_cast<unsigned char>(text.data[i])) return false;
  return wide[text.size] == L'\0';
}
// The supplied digest and anchor must be authenticated independently. Object
// inspection, time validity, and all absent evidence remain separate denials.
[[maybe_unused]] bool join_startup_anchor(const StartupQualification& q, StartupSlice digest, const Anchor& a) {
  return q.epoch == a.epoch && q.generation == a.generation &&
    startup_wide_equal(q.service_sid,a.service_sid,sizeof(a.service_sid)/sizeof(a.service_sid[0])) &&
    startup_wide_equal(q.holder.reservation,a.reservation,sizeof(a.reservation)/sizeof(a.reservation[0])) &&
    startup_hex_bytes(q.host,a.host,sizeof(a.host)) && startup_hex_bytes(q.boot,a.boot,sizeof(a.boot)) &&
    startup_hex_bytes(q.source,a.source,sizeof(a.source)) && startup_hex_bytes(q.receiver,a.receiver,sizeof(a.receiver)) &&
    startup_hex_bytes(digest,a.qualification,sizeof(a.qualification));
}
struct StartupFundingProjection {
  StartupSlice qualification_id, qualification_hash, reservation, record_hash, prepayment,
               service_start, node_launch, psql_attempt;
};
[[maybe_unused]] bool decode_startup_funding(StartupSlice input, StartupFundingProjection* out) {
  if (!out) return false;
  StartupField f[] = {{"nodeLaunchId"},{"prepaymentReceiptHash"},{"psqlAttemptId"},
    {"qualificationHash"},{"qualificationId"},{"reservationId"},{"reservationRecordHash"},{"serviceStartId"}};
  if (!startup_object(input,f,8) || !startup_id(f[0].value) || !startup_hash(f[1].value) ||
      !startup_id(f[2].value) || !startup_hash(f[3].value) || !startup_id(f[4].value) ||
      !startup_id(f[5].value) || !startup_hash(f[6].value) || !startup_id(f[7].value)) return false;
  *out = {f[4].value,f[3].value,f[5].value,f[6].value,f[1].value,f[7].value,f[0].value,f[2].value};
  return true;
}
struct StartupPrelaunchProjection {
  StartupSlice attempt, event, charge_kind, charge_key, charge_binding, prepayment, fence;
};
[[maybe_unused]] bool decode_startup_prelaunch(StartupSlice input, StartupPrelaunchProjection* out) {
  if (!out) return false;
  StartupField f[] = {{"attemptId"},{"chargeBindingHash"},{"chargeEventKey"},{"chargeKind"},
    {"eventId"},{"fenceId"},{"prepaymentReceiptHash"}};
  if (!startup_object(input,f,7) || !startup_id(f[0].value) || !startup_hash(f[1].value) ||
      !startup_id(f[2].value) || !startup_id(f[3].value) || !startup_id(f[4].value) ||
      !startup_id(f[5].value) || !startup_hash(f[6].value)) return false;
  *out = {f[0].value,f[4].value,f[3].value,f[2].value,f[1].value,f[6].value,f[5].value};
  return true;
}
// Exact projection equality is structural only. qualification_hash must be
// calculated independently over the retained authenticated qualification bytes.
[[maybe_unused]] bool join_startup_permit(const StartupQualification& q, StartupSlice qualification_hash,
                                          const StartupFundingProjection& funding,
                                          const StartupPrelaunchProjection& prelaunch,
                                          StartupSlice dispatch_attempt) {
  const StartupAttempt& p = q.attempts[2];
  return startup_hash(qualification_hash) && startup_id(dispatch_attempt) &&
    startup_equal(funding.qualification_id,q.id) && startup_equal(funding.qualification_hash,qualification_hash) &&
    startup_equal(funding.reservation,q.holder.reservation) && startup_equal(funding.record_hash,q.holder.record_hash) &&
    startup_equal(funding.prepayment,q.holder.prepayment) && startup_equal(funding.service_start,q.attempts[0].id) &&
    startup_equal(funding.node_launch,q.attempts[1].id) && startup_equal(funding.psql_attempt,p.id) &&
    startup_equal(prelaunch.attempt,p.id) && startup_equal(dispatch_attempt,p.id) &&
    startup_equal(prelaunch.event,p.event) && startup_equal(prelaunch.charge_kind,p.charge_kind) &&
    startup_equal(prelaunch.charge_key,p.charge_key) && startup_equal(prelaunch.charge_binding,p.charge_binding) &&
    startup_equal(prelaunch.prepayment,p.prepayment) && startup_equal(prelaunch.fence,p.fence);
}
// Correlation only: no endpoint, authentication, process inspection or authority.
// Expectations must come from independently verified, retained evidence.
enum class ChannelSender { parent, node };
// A future owner supplies the bounded stage transport; no endpoint is chosen here.
// It must return exactly one complete frame for the requested sender and stage.
using ChannelStage = bool (*)(void*, size_t, ChannelSender, unsigned char*, size_t, size_t*);
struct ChannelExpected {
  StartupSlice nonce, qualification_hash, permit_hash, delivery_hash, input_hash;
  uint64_t service_pid, service_creation, node_pid, node_creation;
  uint64_t psql_pid, psql_creation, input_length;
};
static bool channel_number(StartupSlice s, bool positive, uint64_t expected, uint64_t ceiling = UINT64_MAX) {
  uint64_t value = 0;
  return startup_decimal(s.data,s.size,positive,&value) && value <= ceiling && value == expected;
}
static bool channel_payload(StartupSlice input, size_t stage, const StartupQualification& q,
                            const ChannelExpected& e) {
  if (stage == 0) return startup_literal(input,"{}");
  if (stage == 1) {
    StartupField f[] = {{"permitHash"}};
    return startup_object(input,f,1) && startup_equal(f[0].value,e.permit_hash);
  }
  if (stage == 2) {
    StartupField f[] = {{"permitHash"},{"psqlFenceId"}};
    return startup_object(input,f,2) && startup_equal(f[0].value,e.permit_hash) &&
      startup_equal(f[1].value,q.attempts[2].fence);
  }
  if (stage == 3) {
    StartupField f[] = {{"psqlCreationTime"},{"psqlPid"}};
    return startup_object(input,f,2) && channel_number(f[0].value,false,e.psql_creation) &&
      channel_number(f[1].value,true,e.psql_pid,UINT32_MAX);
  }
  StartupField f[] = {{"deliveryReceiptHash"},{"inputHash"},{"inputLength"}};
  return startup_object(input,f,3) && startup_equal(f[0].value,e.delivery_hash) &&
    startup_equal(f[1].value,e.input_hash) && channel_number(f[2].value,false,e.input_length);
}
static bool channel_decode(StartupSlice json, size_t stage, const StartupQualification& q,
                           const ChannelExpected& e) {
  static const char* const names[] = {"HELLO","PERMIT_VERIFIED","PSQL_LAUNCH_READY",
    "PSQL_STARTED","DISPATCH_CHECK","DISPATCH_CURRENT"};
  if (stage >= 6 || !json.size || json.size > 4096) return false;
  StartupField f[] = {{"bootIdentity"},{"nodeCreationTime"},{"nodeLaunchId"},{"nodePid"},
    {"nonce"},{"payload",{},true},{"psqlAttemptId"},{"qualificationHash"},
    {"schemaVersion"},{"sequence"},{"serviceCreationTime"},{"servicePid"},
    {"serviceStartId"},{"stage"}};
  return startup_object(json,f,14) && startup_equal(f[0].value,q.boot) &&
    channel_number(f[1].value,false,e.node_creation) && startup_equal(f[2].value,q.attempts[1].id) &&
    channel_number(f[3].value,true,e.node_pid,UINT32_MAX) && startup_equal(f[4].value,e.nonce) &&
    channel_payload(f[5].value,stage,q,e) && startup_equal(f[6].value,q.attempts[2].id) &&
    startup_equal(f[7].value,e.qualification_hash) &&
    startup_literal(f[8].value,"pro273-installer-channel-v1") &&
    channel_number(f[9].value,true,stage + 1) &&
    channel_number(f[10].value,false,e.service_creation) &&
    channel_number(f[11].value,true,e.service_pid,UINT32_MAX) &&
    startup_equal(f[12].value,q.attempts[0].id) && startup_literal(f[13].value,names[stage]);
}
// Encode only a validated canonical payload; never emit a partial frame.
static bool channel_encode(StartupSlice json, unsigned char* output, size_t capacity, size_t* written) {
  if (!json.data || !json.size || json.size > 4096 || !output || !written || capacity < json.size + 4)
    return false;
  const uint32_t n = static_cast<uint32_t>(json.size);
  output[0] = static_cast<unsigned char>(n); output[1] = static_cast<unsigned char>(n >> 8);
  output[2] = static_cast<unsigned char>(n >> 16); output[3] = static_cast<unsigned char>(n >> 24);
  std::memcpy(output + 4,json.data,json.size); *written = json.size + 4; return true;
}
// One owning invocation consumes all six complete frames. Failure and success
// are terminal; the exchange cannot be copied, resumed or reused. Sequence
// numbers are fixed to 1 through 6. Callers retain expectations for this call.
class ChannelExchange {
 public:
  ChannelExchange() = default;
  ChannelExchange(const ChannelExchange&) = delete;
  ChannelExchange& operator=(const ChannelExchange&) = delete;
  bool consume(ChannelStage stage, void* context, const StartupQualification& q,
               const ChannelExpected& e) {
    if (state_ != State::fresh) { state_ = State::failed; return false; }
    state_ = State::running;
    const auto fail = [this]() { state_ = State::failed; return false; };
    if (!stage || q.limits.values[1] < 6 || !q.limits.values[0] ||
        !startup_hex(e.nonce,64) || !startup_hash(e.qualification_hash) ||
        !startup_hash(e.permit_hash) || !startup_hash(e.delivery_hash) || !startup_hash(e.input_hash) ||
        !startup_hex(q.boot,32) || !startup_id(q.attempts[0].id) || !startup_id(q.attempts[1].id) ||
        !startup_id(q.attempts[2].id) || !startup_id(q.attempts[2].fence)) return fail();
    static const ChannelSender senders[] = {ChannelSender::parent,ChannelSender::node,
      ChannelSender::parent,ChannelSender::node,ChannelSender::node,ChannelSender::parent};
    for (size_t i = 0; i < 6; ++i) {
      size_t frame_size = 0;
      const bool staged = stage(context,i,senders[i],bytes_,sizeof(bytes_),&frame_size);
      if (state_ != State::running || !staged ||
          frame_size < 5 || frame_size > sizeof(bytes_)) return fail();
      const uint32_t length = static_cast<uint32_t>(bytes_[0]) |
        (static_cast<uint32_t>(bytes_[1]) << 8) | (static_cast<uint32_t>(bytes_[2]) << 16) |
        (static_cast<uint32_t>(bytes_[3]) << 24);
      if (!length || length > 4096 || length > q.limits.values[0] || frame_size != size_t(length) + 4) return fail();
      StartupSlice json{reinterpret_cast<const char*>(bytes_ + 4),length};
      if (!channel_decode(json,i,q,e)) return fail();
      size_t written = 0;
      if (!channel_encode(json,encoded_,sizeof(encoded_),&written) || written != frame_size ||
          std::memcmp(bytes_,encoded_,written)) return fail();
    }
    if (state_ != State::running) return fail();
    state_ = State::completed;
    return true;
  }
 private:
  enum class State { fresh, running, failed, completed };
  State state_ = State::fresh;
  unsigned char bytes_[4100]{}, encoded_[4100]{};
};

// V2 is an isolated, fixed-buffer correlation model. No callback is accepted;
// no result below authenticates a process, SQL session, receipt or dispatch.
static uint32_t v2_rotr(uint32_t x, unsigned n) { return (x >> n) | (x << (32 - n)); }
static bool v2_sha256(const unsigned char* data, size_t n, unsigned char out[32]) {
  static const uint32_t k[64] = {
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2 };
  if (!data || !out || n > 4096) return false;
  uint32_t h[8] = {0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
  const size_t blocks = (n + 9 + 63) / 64;
  for (size_t block = 0; block < blocks; ++block) {
    uint32_t w[64]{};
    for (size_t j = 0; j < 64; ++j) {
      const size_t pos = block * 64 + j;
      unsigned char b = pos < n ? data[pos] : pos == n ? 0x80 : 0;
      if (pos >= blocks * 64 - 8) b = static_cast<unsigned char>((static_cast<uint64_t>(n) * 8) >> ((blocks * 64 - 1 - pos) * 8));
      w[j / 4] |= static_cast<uint32_t>(b) << (24 - 8 * (j % 4));
    }
    for (size_t i = 16; i < 64; ++i) {
      const uint32_t a = w[i-15], b = w[i-2];
      w[i] = w[i-16] + (v2_rotr(a,7)^v2_rotr(a,18)^(a>>3)) + w[i-7] + (v2_rotr(b,17)^v2_rotr(b,19)^(b>>10));
    }
    uint32_t a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],z=h[7];
    for (size_t i=0;i<64;++i) {
      const uint32_t t1=z+(v2_rotr(e,6)^v2_rotr(e,11)^v2_rotr(e,25))+((e&f)^(~e&g))+k[i]+w[i];
      const uint32_t t2=(v2_rotr(a,2)^v2_rotr(a,13)^v2_rotr(a,22))+((a&b)^(a&c)^(b&c));
      z=g; g=f; f=e; e=d+t1; d=c; c=b; b=a; a=t1+t2;
    }
    h[0]+=a;h[1]+=b;h[2]+=c;h[3]+=d;h[4]+=e;h[5]+=f;h[6]+=g;h[7]+=z;
  }
  for (size_t i=0;i<8;++i) for (size_t j=0;j<4;++j) out[4*i+j]=static_cast<unsigned char>(h[i]>>(24-8*j));
  return true;
}
static bool v2_hash(const unsigned char* data, size_t n, StartupSlice expected) {
  unsigned char digest[32]{};
  return startup_hash(expected) && v2_sha256(data,n,digest) && startup_hex_bytes(expected,digest,32);
}
static int v2_b64_digit(char c) {
  if (c >= 'A' && c <= 'Z') return c-'A';
  if (c >= 'a' && c <= 'z') return c-'a'+26;
  if (c >= '0' && c <= '9') return c-'0'+52;
  return c == '+' ? 62 : c == '/' ? 63 : -1;
}
// Check all sizes, alphabet and unused pad bits before decoding into fixed storage.
static bool v2_receipt(StartupSlice text, StartupSlice hash, size_t maximum, unsigned char* decoded) {
  if (!text.data || !decoded || !startup_hash(hash) || !maximum || maximum > 3072 ||
      !text.size || text.size % 4 || text.size > 4 * ((maximum + 2) / 3)) return false;
  const size_t pad = text.data[text.size-1] == '=' ? (text.data[text.size-2] == '=' ? 2 : 1) : 0;
  const size_t length = text.size / 4 * 3 - pad;
  if (!length || length > maximum) return false;
  for (size_t i=0;i<text.size-pad;++i) if (v2_b64_digit(text.data[i]) < 0) return false;
  if ((pad == 2 && (v2_b64_digit(text.data[text.size-3]) & 15)) ||
      (pad == 1 && (v2_b64_digit(text.data[text.size-2]) & 3))) return false;
  size_t at=0;
  for (size_t i=0;i<text.size;i+=4) {
    const unsigned a=v2_b64_digit(text.data[i]), b=v2_b64_digit(text.data[i+1]);
    const unsigned c=text.data[i+2]=='=' ? 0 : v2_b64_digit(text.data[i+2]);
    const unsigned d=text.data[i+3]=='=' ? 0 : v2_b64_digit(text.data[i+3]);
    const uint32_t v=(a<<18)|(b<<12)|(c<<6)|d;
    decoded[at++]=static_cast<unsigned char>(v>>16);
    if (at<length) decoded[at++]=static_cast<unsigned char>(v>>8);
    if (at<length) decoded[at++]=static_cast<unsigned char>(v);
  }
  return at == length && v2_hash(decoded,length,hash);
}
// UNKNOWN has JSON null, not a quoted string. All other fields use the
// existing closed canonical object parser and its ASCII/unescaped constraints.
static bool v2_outcome(StartupSlice input, size_t max_receipt, unsigned char* decoded) {
  const char unknown[] = "{\"receiptFrameBase64\":null,\"receiptFrameHash\":null,\"status\":\"UNKNOWN\"}";
  if (startup_literal(input,unknown)) return true;
  StartupField f[]={{"receiptFrameBase64"},{"receiptFrameHash"},{"status"}};
  return startup_object(input,f,3) && startup_literal(f[2].value,"COMMITTED") &&
    v2_receipt(f[0].value,f[1].value,max_receipt,decoded);
}
struct ChannelV2Expected {
  ChannelExpected common;
  StartupSlice psql_image_hash, snapshot_hash;
  size_t max_receipt;
};
static bool v2_payload(StartupSlice input, size_t stage, const StartupQualification& q,
                       const ChannelV2Expected& e, unsigned char* decoded) {
  const ChannelExpected& x=e.common;
  if (stage==0) return startup_literal(input,"{}");
  if (stage==1) { StartupField f[]={{"permitHash"}}; return startup_object(input,f,1) && startup_equal(f[0].value,x.permit_hash); }
  if (stage==2) { StartupField f[]={{"permitHash"},{"psqlFenceId"}}; return startup_object(input,f,2) && startup_equal(f[0].value,x.permit_hash) && startup_equal(f[1].value,q.attempts[2].fence); }
  if (stage==3) { StartupField f[]={{"psqlPid"}}; return startup_object(input,f,1) && channel_number(f[0].value,true,x.psql_pid,UINT32_MAX); }
  if (stage==4) {
    StartupField f[]={{"snapshot",{},true},{"snapshotHash"}};
    StartupField s[]={{"bootIdentity"},{"nodeCreationTime"},{"nodePid"},{"nonce"},{"psqlCreationTime"},{"psqlImageHash"},{"psqlPid"},{"qualificationHash"}};
    if (!startup_object(input,f,2) || !startup_object(f[0].value,s,8) ||
        !startup_equal(f[1].value,e.snapshot_hash) || !startup_equal(s[0].value,q.boot) ||
        !channel_number(s[1].value,true,x.node_creation) || !channel_number(s[2].value,true,x.node_pid,UINT32_MAX) ||
        !startup_equal(s[3].value,x.nonce) || !channel_number(s[4].value,true,x.psql_creation) ||
        !startup_equal(s[5].value,e.psql_image_hash) || !channel_number(s[6].value,true,x.psql_pid,UINT32_MAX) ||
        !startup_equal(s[7].value,x.qualification_hash)) return false;
    const char prefix[]="[\"pro273.installer.psql-snapshot.v2\",";
    unsigned char preimage[4096]{}; const size_t n=sizeof(prefix)-1;
    if (f[0].value.size > sizeof(preimage)-n-1) return false;
    std::memcpy(preimage,prefix,n); std::memcpy(preimage+n,f[0].value.data,f[0].value.size);
    preimage[n+f[0].value.size]=']';
    return v2_hash(preimage,n+f[0].value.size+1,f[1].value);
  }
  if (stage==5) {
    StartupField f[]={{"deliveryReceiptBase64"},{"deliveryReceiptHash"},{"inputHash"},{"inputLength"}};
    return startup_object(input,f,4) && startup_equal(f[1].value,x.delivery_hash) && startup_equal(f[2].value,x.input_hash) &&
      channel_number(f[3].value,true,x.input_length) && v2_receipt(f[0].value,f[1].value,e.max_receipt,decoded);
  }
  if (stage==6) {
    StartupField f[]={{"deliveryReceiptHash"},{"inputHash"},{"inputLength"},{"snapshotHash"}};
    return startup_object(input,f,4) && startup_equal(f[0].value,x.delivery_hash) && startup_equal(f[1].value,x.input_hash) &&
      channel_number(f[2].value,true,x.input_length) && startup_equal(f[3].value,e.snapshot_hash);
  }
  return stage==7 && v2_outcome(input,e.max_receipt,decoded);
}
static bool v2_decode(StartupSlice json, size_t stage, const StartupQualification& q,
                      const ChannelV2Expected& e, unsigned char* decoded) {
  static const char* names[]={"HELLO","PERMIT_VERIFIED","PSQL_LAUNCH_READY","PSQL_STARTED",
    "PSQL_AUTHENTICATED","DISPATCH_CHECK","DISPATCH_CURRENT","OUTCOME"};
  if (stage>=8 || !json.data || !json.size || json.size>4092) return false;
  const ChannelExpected& x=e.common;
  StartupField f[]={{"bootIdentity"},{"nodeCreationTime"},{"nodeLaunchId"},{"nodePid"},
    {"nonce"},{"payload",{},true},{"psqlAttemptId"},{"qualificationHash"},{"schemaVersion"},
    {"sequence"},{"serviceCreationTime"},{"servicePid"},{"serviceStartId"},{"stage"}};
  return startup_object(json,f,14) && startup_equal(f[0].value,q.boot) &&
    channel_number(f[1].value,true,x.node_creation) && startup_equal(f[2].value,q.attempts[1].id) &&
    channel_number(f[3].value,true,x.node_pid,UINT32_MAX) && startup_equal(f[4].value,x.nonce) &&
    v2_payload(f[5].value,stage,q,e,decoded) && startup_equal(f[6].value,q.attempts[2].id) &&
    startup_equal(f[7].value,x.qualification_hash) && startup_literal(f[8].value,"pro273-installer-channel-v2") &&
    channel_number(f[9].value,true,stage+1) && channel_number(f[10].value,true,x.service_creation) &&
    channel_number(f[11].value,true,x.service_pid,UINT32_MAX) && startup_equal(f[12].value,q.attempts[0].id) &&
    startup_literal(f[13].value,names[stage]);
}
// Exact owner-held phase copies provide consistency, not authentication.
struct V2PhaseSnapshot {
  unsigned char bytes[1024]{};
  size_t size=0;
  bool captured=false;
  bool pin(const StartupSlice* slices, size_t slice_count, const uint64_t* numbers, size_t number_count) {
    unsigned char candidate[1024]{}; size_t at=0;
    for (size_t i=0;i<slice_count;++i) {
      const StartupSlice& s=slices[i];
      if (!s.data || s.size>255 || at==sizeof(candidate) || s.size>sizeof(candidate)-at-1) return false;
      candidate[at++]=static_cast<unsigned char>(s.size);
      std::memcpy(candidate+at,s.data,s.size); at+=s.size;
    }
    for (size_t i=0;i<number_count;++i) {
      if (sizeof(candidate)-at<8) return false;
      for (unsigned j=0;j<8;++j) candidate[at++]=static_cast<unsigned char>(numbers[i]>>(8*j));
    }
    if (captured) return size==at && !std::memcmp(bytes,candidate,at);
    std::memcpy(bytes,candidate,at); size=at; captured=true; return true;
  }
};
// Each call is one modeled event. An ACK advances only the exact accepted stage;
// it is not an I/O acknowledgement or permission to execute SQL. EOF is only
// legal after stage 7 and stage 8 ACKs. Any misuse permanently poisons the object.
// Calls must be serialized; this disconnected model is not thread-safe.
class ChannelV2Exchange {
 public:
  ChannelV2Exchange() = default;
  ChannelV2Exchange(const ChannelV2Exchange&) = delete;
  ChannelV2Exchange& operator=(const ChannelV2Exchange&) = delete;
  bool accept(const unsigned char* frame, size_t size, ChannelSender sender,
              const StartupQualification& q, const ChannelV2Expected& e) {
    if (busy_ || state_ != State::frame) return fail();
    busy_=true;
    const ChannelExpected& x=e.common;
    if (!frame || size<5 || size>sizeof(frame_) || q.limits.values[1]<8 ||
        q.limits.values[0]<5 || size>q.limits.values[0] ||
        !e.max_receipt || e.max_receipt>sizeof(decoded_) || !startup_hex(x.nonce,64) ||
        !startup_hash(x.qualification_hash) || !startup_hex(q.boot,32) ||
        !startup_id(q.attempts[0].id) || !startup_id(q.attempts[1].id) || !startup_id(q.attempts[2].id) ||
        !x.service_pid || x.service_pid>UINT32_MAX || !x.service_creation ||
        !x.node_pid || x.node_pid>UINT32_MAX || !x.node_creation ||
        startup_equal(q.attempts[0].id,q.attempts[1].id) || startup_equal(q.attempts[0].id,q.attempts[2].id) ||
        startup_equal(q.attempts[1].id,q.attempts[2].id) ||
        sender != (next_%2 ? ChannelSender::node : ChannelSender::parent)) return fail();
    const StartupSlice initial[]={q.boot,q.attempts[0].id,q.attempts[1].id,q.attempts[2].id,x.nonce,x.qualification_hash};
    const uint64_t initial_numbers[]={q.limits.values[0],q.limits.values[1],x.service_pid,x.service_creation,
      x.node_pid,x.node_creation,static_cast<uint64_t>(e.max_receipt)};
    if (!phases_[0].pin(initial,6,initial_numbers,7)) return fail();
    if (next_>=1) {
      const StartupSlice permit[]={x.permit_hash};
      if (!startup_hash(permit[0]) || !phases_[1].pin(permit,1,nullptr,0)) return fail();
    }
    if (next_>=2) {
      const StartupSlice fence[]={q.attempts[2].fence};
      if (!startup_id(fence[0]) || !phases_[2].pin(fence,1,nullptr,0)) return fail();
    }
    if (next_>=3) {
      const uint64_t pid[]={x.psql_pid};
      if (!x.psql_pid || x.psql_pid>UINT32_MAX || !phases_[3].pin(nullptr,0,pid,1)) return fail();
    }
    if (next_>=4) {
      const StartupSlice snapshot[]={e.psql_image_hash,e.snapshot_hash};
      const uint64_t creation[]={x.psql_creation};
      if (!x.psql_creation || !startup_hash(snapshot[0]) || !startup_hash(snapshot[1]) ||
          !phases_[4].pin(snapshot,2,creation,1)) return fail();
    }
    if (next_>=5) {
      const StartupSlice delivery[]={x.delivery_hash,x.input_hash};
      const uint64_t length[]={x.input_length};
      if (!x.input_length || !startup_hash(delivery[0]) || !startup_hash(delivery[1]) ||
          !phases_[5].pin(delivery,2,length,1)) return fail();
    }
    std::memcpy(frame_,frame,size);
    const uint32_t n=static_cast<uint32_t>(frame_[0]) | (static_cast<uint32_t>(frame_[1])<<8) |
      (static_cast<uint32_t>(frame_[2])<<16) | (static_cast<uint32_t>(frame_[3])<<24);
    if (!n || n>4092 || size!=static_cast<size_t>(n)+4 ||
        !v2_decode({reinterpret_cast<const char*>(frame_+4),n},next_,q,e,decoded_)) return fail();
    state_=State::ack; busy_=false; return true;
  }
  bool ack(size_t sequence) {
    if (busy_ || state_!=State::ack || sequence!=next_+1) return fail();
    ++next_; state_=next_==5 ? State::modeled_sql : next_==7 ? State::service_eof : next_==8 ? State::node_eof : State::frame; return true;
  }
  // A sequencing marker only. It does not start or authorize SQL work.
  bool modeled_sql_work() {
    if (busy_ || state_!=State::modeled_sql) return fail();
    state_=State::frame; return true;
  }
  bool abort() { return fail(); }
  bool eof(ChannelSender sender, bool clean, size_t trailing_bytes) {
    if (busy_ || !clean || trailing_bytes ||
        !((state_==State::service_eof && sender==ChannelSender::parent) ||
          (state_==State::node_eof && sender==ChannelSender::node))) return fail();
    state_=state_==State::service_eof ? State::frame : State::complete; return true;
  }
 private:
  enum class State { frame, ack, modeled_sql, service_eof, node_eof, complete, failed };
  bool fail() { state_=State::failed; busy_=false; return false; }
  State state_=State::frame; size_t next_=0; bool busy_=false;
  unsigned char frame_[4096]{}, decoded_[3072]{};
  V2PhaseSnapshot phases_[6]{};
};

// Disconnected framing/write model. Caller supplies valid extents and serializes
// calls; no address or caller buffer survives a call. Budgets are ceilings,
// not evidence of funding. Every attempt spends an operation, including errors.
class ChannelV2ByteAdapter {
 public:
  ChannelV2ByteAdapter(size_t maximum, size_t operations, size_t zero_progress)
      : maximum_(maximum < sizeof(frame_) ? maximum : sizeof(frame_)),
        operations_(operations), zero_limit_(zero_progress) {
    if (maximum_ < 5 || !operations_) state_=State::failed;
  }
  ChannelV2ByteAdapter(const ChannelV2ByteAdapter&) = delete;
  ChannelV2ByteAdapter& operator=(const ChannelV2ByteAdapter&) = delete;
  bool feed(const unsigned char* bytes, size_t size, ChannelSender direction, size_t* consumed,
            const StartupQualification& q, const ChannelV2Expected& e) {
    if (!begin() || !consumed || (size && !bytes) || state_!=State::input || direction!=sender() ||
        q.limits.values[0]<5 || maximum_!=(q.limits.values[0]<4096 ? q.limits.values[0] : 4096) ||
        !disjoint(consumed,sizeof(*consumed),bytes,size) || !disjoint(consumed,sizeof(*consumed),this,sizeof(*this)) ||
        !disjoint(consumed,sizeof(*consumed),&q,sizeof(q)) || !disjoint(consumed,sizeof(*consumed),&e,sizeof(e))) return fail();
    *consumed=0;
    while (*consumed<size && (!target_ || used_<target_)) {
      frame_[used_++]=bytes[(*consumed)++];
      if (used_==4) {
        const uint32_t body=static_cast<uint32_t>(frame_[0]) | (static_cast<uint32_t>(frame_[1])<<8) |
          (static_cast<uint32_t>(frame_[2])<<16) | (static_cast<uint32_t>(frame_[3])<<24);
        if (!body || body>maximum_-4) return fail();
        target_=static_cast<size_t>(body)+4;
      }
    }
    if (target_ && used_==target_) {
      if (next_>=6 && *consumed<size) return fail();
      if (!exchange_.accept(frame_,target_,direction,q,e)) return fail();
      state_=State::write;
    }
    busy_=false; return true;
  }
  bool offer(ChannelSender direction, unsigned char* output, size_t capacity, size_t* count, size_t* ticket) {
    if (!begin() || state_!=State::write || direction!=sender() || offered_ || !output || !capacity || !count || !ticket || ticket_==SIZE_MAX ||
        !disjoint(output,capacity,count,sizeof(*count)) || !disjoint(output,capacity,this,sizeof(*this)) ||
        !disjoint(count,sizeof(*count),this,sizeof(*this)) || !disjoint(ticket,sizeof(*ticket),this,sizeof(*this)) ||
        !disjoint(output,capacity,ticket,sizeof(*ticket)) || !disjoint(count,sizeof(*count),ticket,sizeof(*ticket))) return fail();
    offered_=capacity<target_-written_ ? capacity : target_-written_;
    std::memcpy(output,frame_+written_,offered_); *count=offered_; *ticket=++ticket_;
    busy_=false; return true;
  }
  bool ack(ChannelSender direction, size_t ticket, size_t count) {
    if (!begin() || state_!=State::write || direction!=sender() || !offered_ || ticket!=ticket_ || count>offered_) return fail();
    offered_=0;
    if (!count && (zero_==zero_limit_ || ++zero_>zero_limit_)) return fail();
    written_+=count;
    if (written_==target_) {
      if (!exchange_.ack(next_+1)) return fail();
      ++next_; used_=target_=written_=0;
      state_=next_==5 ? State::sql : next_==7 ? State::service_eof : next_==8 ? State::node_eof : State::input;
    }
    busy_=false; return true;
  }
  bool modeled_sql_work() {
    if (!begin() || state_!=State::sql || !exchange_.modeled_sql_work()) return fail();
    state_=State::input; busy_=false; return true;
  }
  bool eof(ChannelSender direction, bool clean) {
    if (!begin() || used_ || offered_ || !clean ||
        !((state_==State::service_eof && direction==ChannelSender::parent) ||
          (state_==State::node_eof && direction==ChannelSender::node)) ||
        !exchange_.eof(direction,true,0)) return fail();
    state_=state_==State::service_eof ? State::input : State::complete;
    busy_=false; return true;
  }
 private:
  enum class State { input, write, sql, service_eof, node_eof, complete, failed };
  static bool disjoint(const void* a, size_t an, const void* b, size_t bn) {
    if (!an || !bn) return true;
    const uintptr_t x=reinterpret_cast<uintptr_t>(a), y=reinterpret_cast<uintptr_t>(b);
    if (!x || !y || an>UINTPTR_MAX-x || bn>UINTPTR_MAX-y) return false;
    return x+an<=y || y+bn<=x;
  }
  bool fail() { state_=State::failed; busy_=false; return false; }
  bool begin() {
    if (busy_ || state_==State::failed || state_==State::complete || !operations_) return false;
    --operations_; busy_=true; return true;
  }
  ChannelSender sender() const { return next_%2 ? ChannelSender::node : ChannelSender::parent; }
  ChannelV2Exchange exchange_{};
  unsigned char frame_[4096]{};
  size_t maximum_, operations_, zero_limit_, zero_=0, used_=0, target_=0, written_=0, offered_=0, ticket_=0, next_=0;
  State state_=State::input; bool busy_=false;
};
// No independent limit-to-holder mapping, prepaid evidence, anchor/actual
// identity, durable fence or loader qualification is established here.
// Structural decoding and joins must never be promoted into admission.
[[maybe_unused]] bool startup_qualification_admitted() { return false; }
// Retained object metadata only: callers must additionally inspect every
// ancestor and object ACL, compare its fixed expected path and hash bytes from
// this same handle. Reparse points, remote filesystems and streams are denied.
struct HeldFileIdentity { FILE_ID_INFO id; FILE_BASIC_INFO basic; LARGE_INTEGER size; };
// Supplied by a future independently verified, prepaid startup allocation.
// Neither these values nor this helper establish qualification or funding.
// The workspace is already reserved and allocated by that allocation, and is
// retained by the caller. There is no size-probe/retry or internal allocation.
struct SecurityInspectionBudget {
  BYTE* workspace;
  DWORD workspace_bytes;
  DWORD qualified_descriptor_bytes;
  ULONGLONG* remaining_prepaid_ace_events;
};
enum class SecurityObjectKind { Scm, Service, Registry, File, Process };

// The untrusted service-SID ACE permits exact, object-specific rights only: no
// generic/MAXIMUM_ALLOWED bits and no change, delete, ownership, control, service
// start/interrogate, process injection or handle duplication. SYSTEM and Admin
// ACE masks are permitted within the existing trusted boundary. A future
// qualification must prove which rights the actual service needs and its
// complete effective access.
bool service_read_mask(SecurityObjectKind kind, ACCESS_MASK* mask) {
  if (!mask) return false;
  switch (kind) {
    case SecurityObjectKind::Scm:
      *mask = SC_MANAGER_CONNECT | READ_CONTROL; return true;
    case SecurityObjectKind::Service:
      *mask = SERVICE_QUERY_CONFIG | SERVICE_QUERY_STATUS | READ_CONTROL; return true;
    case SecurityObjectKind::Registry:
      *mask = KEY_QUERY_VALUE | KEY_ENUMERATE_SUB_KEYS | READ_CONTROL; return true;
    case SecurityObjectKind::File:
      *mask = FILE_READ_DATA | FILE_READ_EA | FILE_EXECUTE | FILE_READ_ATTRIBUTES |
              READ_CONTROL | SYNCHRONIZE; return true;
    case SecurityObjectKind::Process:
      *mask = PROCESS_QUERY_LIMITED_INFORMATION | READ_CONTROL | SYNCHRONIZE; return true;
    default: return false;
  }
}

// No independent token, privilege, parent-rights or existing-handle proof is
// implemented. An ACL subset alone must never be reported as effective safety.
bool qualified_effective_rights() { return false; }

// This checks only a deliberately restrictive DACL subset, not effective
// access. The supplied SID must later be independently authenticated against
// the actual service token; this helper cannot establish that fact. Unknown
// principals, ACE forms and flags deny. Parent rights, token groups, privileges,
// restricted tokens, object identity and existing handles remain unproved.
[[maybe_unused]] bool inspect_object_security(HANDLE object, SecurityObjectKind kind,
                                              const SecurityInspectionBudget& budget,
                                              PSID service_sid) {
  constexpr DWORD kDescriptorCeiling = 65536; // pre-authentication rejection ceiling
  ACCESS_MASK allowed_service_mask = 0;
  if (!object || object == INVALID_HANDLE_VALUE || !budget.workspace ||
      !service_sid || !IsValidSid(service_sid) || !service_read_mask(kind, &allowed_service_mask) ||
      reinterpret_cast<std::uintptr_t>(budget.workspace) % alignof(void*) != 0 ||
      !budget.qualified_descriptor_bytes || !budget.remaining_prepaid_ace_events ||
      !*budget.remaining_prepaid_ace_events || !budget.workspace_bytes ||
      budget.workspace_bytes > kDescriptorCeiling ||
      budget.workspace_bytes > budget.qualified_descriptor_bytes ||
      *budget.remaining_prepaid_ace_events < budget.workspace_bytes / sizeof(ACE_HEADER)) return false;
  DWORD bytes = 0;
  constexpr SECURITY_INFORMATION requested = OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION;
  switch (kind) {
    case SecurityObjectKind::File:
    case SecurityObjectKind::Process:
      if (!GetKernelObjectSecurity(object, requested, budget.workspace,
                                   budget.workspace_bytes, &bytes)) return false;
      break;
    case SecurityObjectKind::Registry:
      bytes = budget.workspace_bytes;
      if (RegGetKeySecurity(reinterpret_cast<HKEY>(object), requested,
                            budget.workspace, &bytes) != ERROR_SUCCESS) return false;
      break;
    case SecurityObjectKind::Scm:
    case SecurityObjectKind::Service:
      if (!QueryServiceObjectSecurity(reinterpret_cast<SC_HANDLE>(object), requested,
                                      budget.workspace, budget.workspace_bytes, &bytes)) return false;
      break;
    default: return false;
  }
  // A larger or changed-size result denies without reallocating or retrying.
  // No file-specific acquisition is qualified here. The future caller must
  // bind the actual object type and held identity; a kind tag is not proof.
  if (bytes < SECURITY_DESCRIPTOR_MIN_LENGTH || bytes > budget.workspace_bytes ||
      bytes > budget.qualified_descriptor_bytes) return false;
  auto* descriptor = reinterpret_cast<PSECURITY_DESCRIPTOR>(budget.workspace);
  if (!IsValidSecurityDescriptor(descriptor) || GetSecurityDescriptorLength(descriptor) != bytes)
    return false;
  PSID owner = nullptr; PACL dacl = nullptr;
  BOOL owner_defaulted = FALSE, dacl_present = FALSE, dacl_defaulted = FALSE;
  if (!GetSecurityDescriptorOwner(descriptor, &owner, &owner_defaulted) ||
      !GetSecurityDescriptorDacl(descriptor, &dacl_present, &dacl, &dacl_defaulted) ||
      !dacl_present) return false;
  alignas(DWORD) BYTE system_buffer[SECURITY_MAX_SID_SIZE], admin_buffer[SECURITY_MAX_SID_SIZE];
  DWORD system_size = sizeof(system_buffer), admin_size = sizeof(admin_buffer);
  PSID system_sid = system_buffer, admin_sid = admin_buffer;
  bool ok = descriptor && owner && dacl && IsValidSid(owner) &&
      CreateWellKnownSid(WinLocalSystemSid, nullptr, system_sid, &system_size) &&
      CreateWellKnownSid(WinBuiltinAdministratorsSid, nullptr, admin_sid, &admin_size) &&
      (EqualSid(owner, system_sid) || EqualSid(owner, admin_sid)) &&
      !EqualSid(service_sid, system_sid) && !EqualSid(service_sid, admin_sid);
  if (ok && static_cast<ULONGLONG>(dacl->AceCount) > *budget.remaining_prepaid_ace_events)
    return false;
  if (ok) ok = IsValidAcl(dacl) != FALSE;
  for (DWORD i = 0; ok && i < dacl->AceCount; ++i) {
    --*budget.remaining_prepaid_ace_events; // spent even on a malformed ACE
    void* raw = nullptr;
    if (!GetAce(dacl, i, &raw)) { ok = false; break; }
    auto* header = static_cast<ACE_HEADER*>(raw);
    if (header->AceType != ACCESS_ALLOWED_ACE_TYPE || header->AceFlags != 0 ||
        header->AceSize < sizeof(ACCESS_ALLOWED_ACE)) { ok = false; break; }
    auto* ace = static_cast<ACCESS_ALLOWED_ACE*>(raw);
    PSID sid = &ace->SidStart;
    const size_t available = header->AceSize - offsetof(ACCESS_ALLOWED_ACE, SidStart);
    if (available < 8 || static_cast<SID*>(sid)->SubAuthorityCount > (available - 8) / sizeof(DWORD) ||
        !IsValidSid(sid) || GetLengthSid(sid) != available) { ok = false; break; }
    if (!EqualSid(sid, system_sid) && !EqualSid(sid, admin_sid) &&
        (!EqualSid(sid, service_sid) || !ace->Mask ||
         (ace->Mask & ~allowed_service_mask) != 0)) ok = false;
  }
  return ok && qualified_effective_rights();
}
[[maybe_unused]] bool inspect_held_file(HANDLE file, HeldFileIdentity* out) {
  if (!out || !file || file == INVALID_HANDLE_VALUE || GetFileType(file) != FILE_TYPE_DISK) return false;
  HeldFileIdentity value{};
  FILE_ATTRIBUTE_TAG_INFO tag{};
  wchar_t path[32768];
  DWORD length = GetFinalPathNameByHandleW(file, path, 32768, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  if (!length || length >= 32768 || length < 7 || wcsncmp(path, L"\\\\?\\", 4) != 0 ||
      path[5] != L':' || path[6] != L'\\') return false;
  for (DWORD i = 6; i < length; ++i) if (path[i] == L':') return false;
  wchar_t root[] = L"C:\\"; root[0] = path[4];
  if (GetDriveTypeW(root) != DRIVE_FIXED) return false;
  wchar_t filesystem[32];
  if (!GetVolumeInformationByHandleW(file, nullptr, 0, nullptr, nullptr, nullptr, filesystem, 32) ||
      wcscmp(filesystem, L"NTFS") != 0 ||
      !GetFileInformationByHandleEx(file, FileAttributeTagInfo, &tag, sizeof(tag)) ||
      (tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) ||
      !GetFileInformationByHandleEx(file, FileIdInfo, &value.id, sizeof(value.id)) ||
      !GetFileInformationByHandleEx(file, FileBasicInfo, &value.basic, sizeof(value.basic))) return false;
  if (!(tag.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) &&
      (!GetFileSizeEx(file, &value.size) || value.size.QuadPart < 0)) return false;
  *out = value;
  return true;
}

// Handles remain owned until the owner is destroyed, including on failure.
struct HeldScm {
  SC_HANDLE manager = nullptr, service = nullptr;
  HeldScm() = default;
  HeldScm(const HeldScm&) = delete;
  HeldScm& operator=(const HeldScm&) = delete;
  ~HeldScm() {
    if (service) CloseServiceHandle(service);
    if (manager) CloseServiceHandle(manager);
  }
};
// Storage and counters must come from the independently prepaid allocation.
struct ScmInspectionBudget {
  BYTE* workspace;
  DWORD workspace_bytes, qualified_workspace_bytes;
  ULONGLONG *remaining_opens, *remaining_handles, *remaining_observations;
};

// Returned SCM pointers must designate an entire terminated string in the
// returned workspace. These values are compared only, never opened or run.
bool scm_string_equal(const BYTE* buffer, DWORD bytes, const wchar_t* text,
                      const wchar_t* expected, size_t units) {
  if (!buffer || !text || !expected || !units || units >= 32767 ||
      reinterpret_cast<std::uintptr_t>(text) % alignof(wchar_t)) return false;
  const auto base = reinterpret_cast<std::uintptr_t>(buffer);
  const auto address = reinterpret_cast<std::uintptr_t>(text);
  if (address < base || address - base > bytes ||
      (bytes - (address - base)) / sizeof(wchar_t) < units + 1) return false;
  for (size_t i = 0; i < units; ++i)
    if (!expected[i] || text[i] != expected[i]) return false;
  return text[units] == L'\0';
}
bool scm_sid_decimal(const wchar_t*& p, ULONGLONG value) {
  wchar_t digits[20]; size_t n = 0;
  do { digits[n++] = static_cast<wchar_t>(L'0' + value % 10); value /= 10; } while (value);
  while (n) { if (!*p || *p != digits[--n]) return false; ++p; }
  return true;
}
// Canonical textual SID comparison without an allocating conversion routine.
bool scm_sid_matches_anchor(PSID sid, DWORD sid_bytes, const wchar_t* anchor) {
  constexpr size_t kSidHeaderBytes = offsetof(SID, SubAuthority);
  if (!sid || !anchor || sid_bytes < kSidHeaderBytes || sid_bytes > SECURITY_MAX_SID_SIZE) return false;
  const BYTE count = static_cast<const SID*>(sid)->SubAuthorityCount;
  if (count > SID_MAX_SUB_AUTHORITIES ||
      count > (sid_bytes - kSidHeaderBytes) / sizeof(DWORD) ||
      !IsValidSid(sid) || GetLengthSid(sid) != sid_bytes ||
      anchor[0] != L'S' || anchor[1] != L'-') return false;
  const wchar_t* p = anchor + 2;
  if (!scm_sid_decimal(p, SID_REVISION) || *p != L'-') return false;
  ++p;
  const SID_IDENTIFIER_AUTHORITY* authority = GetSidIdentifierAuthority(sid);
  ULONGLONG value = 0;
  for (unsigned i = 0; i < 6; ++i) value = (value << 8) | authority->Value[i];
  if (!scm_sid_decimal(p, value)) return false;
  for (BYTE i = 0; i < count; ++i) {
    if (*p != L'-') return false;
    ++p;
    if (!scm_sid_decimal(p, *GetSidSubAuthority(sid, i))) return false;
  }
  return *p == L'\0';
}

// Independent authenticated anchor/manifest, SCM object incarnation, process
// identity and held image linkage have no producers yet. A held handle alone
// or a matching path cannot establish any of those facts.
bool qualified_scm_identity_and_inputs(const HeldScm&, const Anchor&) { return false; }

// The expected image is a comparison value from independently authenticated
// installation evidence, never a path to open or a command to execute. That
// provenance and same-held-image linkage are currently unimplemented and deny.
// The caller retains the owner and workspace through all dependent use.
// This fixed post-binding observation requires RUNNING and cannot serve a
// START_PENDING handshake.
[[maybe_unused]] bool observe_scm(HeldScm& held, const Anchor& anchor,
    const wchar_t* expected_image, size_t image_units, DWORD expected_pid,
    const ScmInspectionBudget& budget, const SecurityInspectionBudget& security) {
  constexpr DWORD kWorkspaceCeiling = 65536; // rejection ceiling, not funding
  constexpr wchar_t kAccount[] = L"NT SERVICE\\HuroofWaOloofInstallerRoot-PRO311-LOCAL-20261028";
  size_t sid_units = 0;
  while (sid_units < sizeof(anchor.service_sid) / sizeof(anchor.service_sid[0]) &&
         anchor.service_sid[sid_units]) ++sid_units;
  if (held.manager || held.service || !expected_image || !image_units || image_units >= 32767 ||
      sid_units == sizeof(anchor.service_sid) / sizeof(anchor.service_sid[0]) ||
      !expected_pid || !budget.workspace ||
      reinterpret_cast<std::uintptr_t>(budget.workspace) % alignof(void*) ||
      !budget.workspace_bytes || budget.workspace_bytes > kWorkspaceCeiling ||
      budget.workspace_bytes > budget.qualified_workspace_bytes ||
      !budget.remaining_opens || !budget.remaining_handles || !budget.remaining_observations ||
      budget.remaining_opens == budget.remaining_handles ||
      budget.remaining_opens == budget.remaining_observations ||
      budget.remaining_handles == budget.remaining_observations ||
      budget.remaining_opens == security.remaining_prepaid_ace_events ||
      budget.remaining_handles == security.remaining_prepaid_ace_events ||
      budget.remaining_observations == security.remaining_prepaid_ace_events ||
      *budget.remaining_opens < 2 || *budget.remaining_handles < 2 ||
      *budget.remaining_observations < 6 ||
      budget.workspace_bytes < sizeof(QUERY_SERVICE_CONFIGW) ||
      budget.workspace_bytes < sizeof(SERVICE_FAILURE_ACTIONSW) ||
      budget.workspace_bytes < sizeof(SERVICE_SID_INFO) ||
      budget.workspace_bytes < sizeof(SERVICE_FAILURE_ACTIONS_FLAG)) return false;
  --*budget.remaining_opens; --*budget.remaining_handles;
  held.manager = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CONNECT | READ_CONTROL);
  if (!held.manager) return false;
  --*budget.remaining_opens; --*budget.remaining_handles;
  held.service = OpenServiceW(held.manager, kService, SERVICE_QUERY_STATUS | SERVICE_QUERY_CONFIG | READ_CONTROL);
  if (!held.service) return false;
  DWORD needed = 0;
  SERVICE_STATUS_PROCESS status{};
  --*budget.remaining_observations;
  if (!QueryServiceStatusEx(held.service, SC_STATUS_PROCESS_INFO, reinterpret_cast<BYTE*>(&status),
      sizeof(status), &needed) ||
      status.dwServiceType != SERVICE_WIN32_OWN_PROCESS || status.dwProcessId != expected_pid ||
      status.dwCurrentState != SERVICE_RUNNING) return false;
  --*budget.remaining_observations;
  std::memset(budget.workspace, 0, budget.workspace_bytes);
  needed = 0;
  // pcbBytesNeeded is a required size on insufficient buffer, not a
  // successful result span. Failure, including insufficient buffer, denies.
  if (!QueryServiceConfigW(held.service, reinterpret_cast<QUERY_SERVICE_CONFIGW*>(budget.workspace),
      budget.workspace_bytes, &needed)) return false;
  const auto* config = reinterpret_cast<const QUERY_SERVICE_CONFIGW*>(budget.workspace);
  if (config->dwServiceType != SERVICE_WIN32_OWN_PROCESS ||
      !scm_string_equal(budget.workspace, budget.workspace_bytes, config->lpServiceStartName, kAccount,
                        sizeof(kAccount) / sizeof(kAccount[0]) - 1) ||
      !scm_string_equal(budget.workspace, budget.workspace_bytes, config->lpBinaryPathName, expected_image, image_units)) return false;
  --*budget.remaining_observations;
  std::memset(budget.workspace, 0, budget.workspace_bytes);
  needed = 0;
  if (!QueryServiceConfig2W(held.service, SERVICE_CONFIG_FAILURE_ACTIONS, budget.workspace,
      budget.workspace_bytes, &needed)) return false;
  const auto* failure = reinterpret_cast<const SERVICE_FAILURE_ACTIONSW*>(budget.workspace);
  if (failure->cActions || failure->lpRebootMsg || failure->lpCommand) return false;
  --*budget.remaining_observations;
  std::memset(budget.workspace, 0, budget.workspace_bytes);
  needed = 0;
  if (!QueryServiceConfig2W(held.service, SERVICE_CONFIG_FAILURE_ACTIONS_FLAG, budget.workspace,
      budget.workspace_bytes, &needed) ||
      reinterpret_cast<const SERVICE_FAILURE_ACTIONS_FLAG*>(budget.workspace)->fFailureActionsOnNonCrashFailures) return false;
  --*budget.remaining_observations;
  std::memset(budget.workspace, 0, budget.workspace_bytes);
  needed = 0;
  if (!QueryServiceConfig2W(held.service, SERVICE_CONFIG_SERVICE_SID_INFO, budget.workspace,
      budget.workspace_bytes, &needed) ||
      reinterpret_cast<const SERVICE_SID_INFO*>(budget.workspace)->dwServiceSidType != SERVICE_SID_TYPE_UNRESTRICTED) return false;
  // Account lookup uses a bounded SID on the already qualified native stack and
  // the existing workspace for domain text. No caller-side probe, retry or
  // allocation; operating-system internal costs still need qualification.
  alignas(DWORD) BYTE sid[SECURITY_MAX_SID_SIZE];
  const DWORD domain_capacity = budget.workspace_bytes / sizeof(wchar_t);
  DWORD sid_bytes = sizeof(sid), domain_chars = domain_capacity;
  SID_NAME_USE use{};
  --*budget.remaining_observations;
  if (!LookupAccountNameW(nullptr, kAccount, sid, &sid_bytes,
      reinterpret_cast<wchar_t*>(budget.workspace), &domain_chars, &use) ||
      sid_bytes > sizeof(sid) || domain_chars > domain_capacity || use != SidTypeWellKnownGroup ||
      !scm_sid_matches_anchor(sid, sid_bytes, anchor.service_sid)) return false;
  return inspect_object_security(reinterpret_cast<HANDLE>(held.manager), SecurityObjectKind::Scm, security, sid) &&
      inspect_object_security(reinterpret_cast<HANDLE>(held.service), SecurityObjectKind::Service, security, sid) &&
      qualified_scm_identity_and_inputs(held, anchor) && qualified_effective_rights();
}

// The allocation, expected SID and epoch must originate in independent,
// authenticated startup evidence, not the observed token or a caller claim.
// No producer for that evidence, or binding of this process handle to the SCM
// incarnation, exists yet. These gates intentionally remain unconditional.
struct TokenInspectionBudget {
  BYTE* workspace;
  DWORD workspace_bytes, qualified_workspace_bytes;
  ULONGLONG *remaining_opens, *remaining_handles, *remaining_queries;
  ULONGLONG *remaining_groups, *remaining_privileges;
};
bool qualified_token_inputs(HANDLE, const Anchor&, const TokenInspectionBudget&) { return false; }
bool qualified_token_process_binding(HANDLE, HANDLE, ULONGLONG) { return false; }

// Every SID returned by the OS must be wholly inside the returned byte span
// before invoking SID APIs. Pointer arithmetic is checked without overflow.
bool token_sid_in_span(const BYTE* buffer, DWORD bytes, PSID sid, DWORD* sid_bytes) {
  constexpr size_t header = offsetof(SID, SubAuthority);
  if (!buffer || !sid || !sid_bytes) return false;
  const auto base = reinterpret_cast<std::uintptr_t>(buffer);
  const auto address = reinterpret_cast<std::uintptr_t>(sid);
  if (address < base || address - base > bytes ||
      bytes - (address - base) < header || address % alignof(DWORD)) return false;
  const auto* value = static_cast<const SID*>(sid);
  const size_t available = bytes - (address - base);
  if (value->SubAuthorityCount > SID_MAX_SUB_AUTHORITIES ||
      value->SubAuthorityCount > (available - header) / sizeof(DWORD)) return false;
  const DWORD length = static_cast<DWORD>(header + value->SubAuthorityCount * sizeof(DWORD));
  if (!IsValidSid(sid) || GetLengthSid(sid) != length) return false;
  *sid_bytes = length;
  return true;
}

// No probes, retries or internal workspace allocations. A failed query spends
// its prepaid observation. Successful result lengths are checked before use.
bool token_query(HANDLE token, TOKEN_INFORMATION_CLASS kind,
                 const TokenInspectionBudget& budget, DWORD minimum, DWORD* bytes) {
  if (!bytes || !*budget.remaining_queries) return false;
  --*budget.remaining_queries;
  std::memset(budget.workspace, 0, budget.workspace_bytes);
  DWORD returned = 0;
  if (!GetTokenInformation(token, kind, budget.workspace, budget.workspace_bytes, &returned) ||
      returned < minimum || returned > budget.workspace_bytes) return false;
  *bytes = returned;
  return true;
}

// After a successful open, the token handle stays held by the caller even on later failure. Inspection is
// an observation, never admission or proof of effective object access.
[[maybe_unused]] bool observe_service_token(HANDLE process, HANDLE* held_token,
    const Anchor& expected, const TokenInspectionBudget& budget) {
  constexpr DWORD kWorkspaceCeiling = 65536, kGroupCeiling = 256, kPrivilegeCeiling = 256;
  if (!process || process == INVALID_HANDLE_VALUE || !held_token ||
      !expected.epoch || !budget.workspace || !budget.workspace_bytes ||
      budget.workspace_bytes > kWorkspaceCeiling ||
      budget.workspace_bytes > budget.qualified_workspace_bytes ||
      reinterpret_cast<std::uintptr_t>(budget.workspace) % alignof(void*) ||
      !budget.remaining_opens || !budget.remaining_handles || !budget.remaining_queries ||
      !budget.remaining_groups || !budget.remaining_privileges) return false;
  ULONGLONG* counters[] = {budget.remaining_opens, budget.remaining_handles,
      budget.remaining_queries, budget.remaining_groups, budget.remaining_privileges};
  const auto workspace_address = reinterpret_cast<std::uintptr_t>(budget.workspace);
  const auto slot_address = reinterpret_cast<std::uintptr_t>(held_token);
  if (workspace_address > UINTPTR_MAX - budget.workspace_bytes ||
      slot_address % alignof(HANDLE) || slot_address > UINTPTR_MAX - sizeof(HANDLE)) return false;
  const auto slot_overlaps = [slot_address](std::uintptr_t address, size_t size) {
    return address > UINTPTR_MAX - size ||
        (slot_address < address + size && address < slot_address + sizeof(HANDLE));
  };
  // The caller retains a separate, stable output slot through cleanup. Reject
  // aliases before reading it or allowing any query to clear the workspace.
  if (slot_overlaps(workspace_address, budget.workspace_bytes) ||
      slot_overlaps(reinterpret_cast<std::uintptr_t>(&expected), sizeof(expected)) ||
      slot_overlaps(reinterpret_cast<std::uintptr_t>(&budget), sizeof(budget))) return false;
  for (size_t i = 0; i < 5; ++i) {
    const auto address = reinterpret_cast<std::uintptr_t>(counters[i]);
    if (address % alignof(ULONGLONG) || address > UINTPTR_MAX - sizeof(ULONGLONG) ||
        slot_overlaps(address, sizeof(ULONGLONG)) ||
        (address < workspace_address + budget.workspace_bytes &&
         workspace_address < address + sizeof(ULONGLONG))) return false;
    for (size_t j = 0; j < i; ++j) {
      const auto other = reinterpret_cast<std::uintptr_t>(counters[j]);
      if (address < other + sizeof(ULONGLONG) && other < address + sizeof(ULONGLONG)) return false;
    }
  }
  if (*held_token) return false;
  size_t sid_units = 0;
  while (sid_units < sizeof(expected.service_sid) / sizeof(expected.service_sid[0]) &&
         expected.service_sid[sid_units]) ++sid_units;
  if (sid_units < 4 || sid_units == sizeof(expected.service_sid) / sizeof(expected.service_sid[0]) ||
      !expected.floor || expected.epoch < expected.floor) return false;
  if (!*budget.remaining_opens || !*budget.remaining_handles ||
      *budget.remaining_queries < 13 || !*budget.remaining_groups ||
      !*budget.remaining_privileges || !qualified_token_inputs(process, expected, budget)) return false;
  --*budget.remaining_opens;
  --*budget.remaining_handles;
  HANDLE token = nullptr;
  const BOOL opened = OpenProcessToken(process, TOKEN_QUERY | READ_CONTROL, &token);
  if (!opened) return false;
  *held_token = token; // Preserve the cleanup identity on every post-open path.
  DWORD bytes = 0, sid_bytes = 0;
  if (!token_query(token, TokenUser, budget, sizeof(TOKEN_USER), &bytes)) return false;
  auto* user = reinterpret_cast<TOKEN_USER*>(budget.workspace);
  if (user->User.Attributes != 0 || !token_sid_in_span(budget.workspace, bytes, user->User.Sid, &sid_bytes) ||
      !scm_sid_matches_anchor(user->User.Sid, sid_bytes, expected.service_sid) ||
      IsWellKnownSid(user->User.Sid, WinLocalSystemSid) ||
      IsWellKnownSid(user->User.Sid, WinBuiltinAdministratorsSid)) return false;

  if (!token_query(token, TokenGroups, budget, offsetof(TOKEN_GROUPS, Groups), &bytes)) return false;
  const auto* groups = reinterpret_cast<const TOKEN_GROUPS*>(budget.workspace);
  if (groups->GroupCount > kGroupCeiling || groups->GroupCount > *budget.remaining_groups ||
      groups->GroupCount > (bytes - offsetof(TOKEN_GROUPS, Groups)) / sizeof(SID_AND_ATTRIBUTES)) return false;
  bool found_service = false;
  constexpr DWORD group_flags = SE_GROUP_MANDATORY | SE_GROUP_ENABLED_BY_DEFAULT | SE_GROUP_ENABLED |
      SE_GROUP_OWNER | SE_GROUP_USE_FOR_DENY_ONLY | SE_GROUP_INTEGRITY | SE_GROUP_INTEGRITY_ENABLED | SE_GROUP_LOGON_ID;
  for (DWORD i = 0; i < groups->GroupCount; ++i) {
    --*budget.remaining_groups;
    const auto& group = groups->Groups[i];
    if ((group.Attributes & ~group_flags) || !token_sid_in_span(budget.workspace, bytes, group.Sid, &sid_bytes)) return false;
    if (scm_sid_matches_anchor(group.Sid, sid_bytes, expected.service_sid)) {
      if (found_service || !(group.Attributes & SE_GROUP_ENABLED) || (group.Attributes & SE_GROUP_USE_FOR_DENY_ONLY)) return false;
      found_service = true;
    }
    if ((IsWellKnownSid(group.Sid, WinBuiltinAdministratorsSid) || IsWellKnownSid(group.Sid, WinLocalSystemSid)) &&
        (group.Attributes & SE_GROUP_ENABLED) && !(group.Attributes & SE_GROUP_USE_FOR_DENY_ONLY)) return false;
  }
  if (!found_service || !token_query(token, TokenPrivileges, budget, offsetof(TOKEN_PRIVILEGES, Privileges), &bytes)) return false;
  const auto* privileges = reinterpret_cast<const TOKEN_PRIVILEGES*>(budget.workspace);
  if (privileges->PrivilegeCount > kPrivilegeCeiling || privileges->PrivilegeCount > *budget.remaining_privileges ||
      privileges->PrivilegeCount > (bytes - offsetof(TOKEN_PRIVILEGES, Privileges)) / sizeof(LUID_AND_ATTRIBUTES)) return false;
  for (DWORD i = 0; i < privileges->PrivilegeCount; ++i) {
    --*budget.remaining_privileges;
    // Even a normally harmless enabled privilege needs independent qualification.
    if (privileges->Privileges[i].Attributes & ~SE_PRIVILEGE_ENABLED_BY_DEFAULT) return false;
  }

  if (!token_query(token, TokenType, budget, sizeof(TOKEN_TYPE), &bytes) ||
      *reinterpret_cast<const TOKEN_TYPE*>(budget.workspace) != TokenPrimary ||
      !token_query(token, TokenElevation, budget, sizeof(TOKEN_ELEVATION), &bytes) ||
      reinterpret_cast<const TOKEN_ELEVATION*>(budget.workspace)->TokenIsElevated != 0 ||
      !token_query(token, TokenElevationType, budget, sizeof(TOKEN_ELEVATION_TYPE), &bytes) ||
      *reinterpret_cast<const TOKEN_ELEVATION_TYPE*>(budget.workspace) != TokenElevationTypeDefault ||
      !token_query(token, TokenHasRestrictions, budget, sizeof(DWORD), &bytes) ||
      *reinterpret_cast<const DWORD*>(budget.workspace) != 0 ||
      !token_query(token, TokenRestrictedSids, budget, offsetof(TOKEN_GROUPS, Groups), &bytes) ||
      reinterpret_cast<const TOKEN_GROUPS*>(budget.workspace)->GroupCount != 0 ||
      !token_query(token, TokenIsAppContainer, budget, sizeof(DWORD), &bytes) ||
      *reinterpret_cast<const DWORD*>(budget.workspace) != 0 ||
      !token_query(token, TokenUIAccess, budget, sizeof(DWORD), &bytes) ||
      *reinterpret_cast<const DWORD*>(budget.workspace) != 0 ||
      !token_query(token, TokenVirtualizationEnabled, budget, sizeof(DWORD), &bytes) ||
      *reinterpret_cast<const DWORD*>(budget.workspace) != 0 ||
      !token_query(token, TokenMandatoryPolicy, budget, sizeof(TOKEN_MANDATORY_POLICY), &bytes) ||
      reinterpret_cast<const TOKEN_MANDATORY_POLICY*>(budget.workspace)->Policy != TOKEN_MANDATORY_POLICY_NO_WRITE_UP ||
      !token_query(token, TokenIntegrityLevel, budget, sizeof(TOKEN_MANDATORY_LABEL), &bytes)) return false;
  const auto* label = reinterpret_cast<const TOKEN_MANDATORY_LABEL*>(budget.workspace);
  if ((label->Label.Attributes & SE_GROUP_INTEGRITY) == 0 ||
      (label->Label.Attributes & ~(SE_GROUP_INTEGRITY | SE_GROUP_INTEGRITY_ENABLED)) != 0 ||
      !token_sid_in_span(budget.workspace, bytes, label->Label.Sid, &sid_bytes) ||
      !IsWellKnownSid(label->Label.Sid, WinMediumLabelSid)) return false;
  return qualified_token_process_binding(process, token, expected.epoch) && qualified_effective_rights();
}

[[maybe_unused]] bool open_anchor(HKEY* key) {
  return RegOpenKeyExW(HKEY_LOCAL_MACHINE, kParameters, 0,
      KEY_QUERY_VALUE | KEY_ENUMERATE_SUB_KEYS | READ_CONTROL | KEY_WOW64_64KEY, key) == ERROR_SUCCESS;
}

bool observe_process_incarnation(HANDLE process, DWORD expected_pid, ULONGLONG expected_created,
                                 ULONGLONG& remaining_queries) {
  if (!process || process == INVALID_HANDLE_VALUE || !expected_pid || !expected_created ||
      remaining_queries < 3) return false;
  --remaining_queries;
  if (GetProcessId(process) != expected_pid) return false;
  FILETIME exited{}, kernel{}, user{};
  FILETIME created{};
  --remaining_queries;
  if (!GetProcessTimes(process, &created, &exited, &kernel, &user)) return false;
  const ULONGLONG created_ticks = (static_cast<ULONGLONG>(created.dwHighDateTime) << 32) | created.dwLowDateTime;
  if (created_ticks != expected_created) return false;
  --remaining_queries;
  return WaitForSingleObject(process, 0) == WAIT_TIMEOUT;
}

constexpr DWORD kModuleObservationLimit = 128;
constexpr DWORD kProcessPathCapacity = 32767;
struct ExpectedImagePath { const wchar_t* text; DWORD length; };
struct ProcessModuleWorkspace {
  HMODULE first[kModuleObservationLimit], last[kModuleObservationLimit];
  wchar_t path[kProcessPathCapacity];
};

// The caller supplies independently authenticated paths, retains the process
// handle, and owns nonoverlapping inputs, workspace and prepaid query count.
// This brackets one pathname observation. It cannot prove the mapped file's
// identity, continuous loader custody, or completeness of future loads.
[[maybe_unused]] bool observe_process_module_paths(HANDLE process, DWORD expected_pid,
    ULONGLONG expected_created, ExpectedImagePath image, const ExpectedImagePath* expected_modules,
    DWORD count, ProcessModuleWorkspace& workspace, ULONGLONG& remaining_queries) {
  const auto supported_path = [](ExpectedImagePath p) {
    return p.text && p.length >= 4 && p.length < kProcessPathCapacity;
  };
  if (sizeof(void*) != 8 || !supported_path(image) || !expected_modules || !count ||
      count > kModuleObservationLimit || remaining_queries < 9 + count) return false;
  for (DWORD i = 0; i < count; ++i) if (!supported_path(expected_modules[i])) return false;
  if (!observe_process_incarnation(process, expected_pid, expected_created, remaining_queries)) return false;
  DWORD length = kProcessPathCapacity;
  --remaining_queries;
  if (!QueryFullProcessImageNameW(process, 0, workspace.path, &length) || length != image.length ||
      std::wmemcmp(workspace.path, image.text, length) != 0) return false;
  DWORD bytes = 0;
  --remaining_queries;
  if (!K32EnumProcessModulesEx(process, workspace.first, sizeof(workspace.first), &bytes, LIST_MODULES_ALL) ||
      bytes != count * sizeof(HMODULE)) return false;
  bool matched[kModuleObservationLimit]{};
  for (DWORD i = 0; i < count; ++i) {
    const HMODULE module = workspace.first[i];
    if (!module) return false;
    for (DWORD j = 0; j < i; ++j) if (workspace.first[j] == module) return false;
    --remaining_queries;
    length = K32GetModuleFileNameExW(process, module, workspace.path, kProcessPathCapacity);
    if (!length || length >= kProcessPathCapacity) return false;
    DWORD j = 0;
    for (; j < count; ++j) {
      const auto& expected = expected_modules[j];
      if (!matched[j] && length == expected.length && std::wmemcmp(workspace.path, expected.text, length) == 0) break;
    }
    if (j == count) return false;
    matched[j] = true;
  }
  --remaining_queries;
  if (!K32EnumProcessModulesEx(process, workspace.last, sizeof(workspace.last), &bytes, LIST_MODULES_ALL) ||
      bytes != count * sizeof(HMODULE) || std::memcmp(workspace.first, workspace.last, bytes) != 0) return false;
  return observe_process_incarnation(process, expected_pid, expected_created, remaining_queries);
}

// A caller must hold this handle through all dependent checks and use. The
// final path, ancestors, remote/reparse state, identities, ACLs and hash are
// still required; obtaining this handle alone never passes an admission.
[[maybe_unused]] HANDLE open_candidate(const wchar_t* path) {
  return CreateFileW(path, GENERIC_READ | READ_CONTROL, FILE_SHARE_READ, nullptr,
      OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, nullptr);
}

// Observation only. The caller owns and retains every handle and all storage;
// counters must come from the independently authenticated startup allocation.
// Holding these handles does not exclude writers or delete-capable handles that
// were opened earlier, hard-link aliases, or privileged filesystem mutation.
struct HeldPathComponent { HANDLE handle; HeldFileIdentity identity; };
struct HeldPathBudget {
  HeldPathComponent* components;
  DWORD capacity;
  wchar_t* path_workspace;
  DWORD path_capacity;
  ULONGLONG* remaining_opens;
  ULONGLONG* remaining_handles;
  ULONGLONG* remaining_observations;
};

bool held_path_slots_empty(const HeldPathComponent* components, DWORD count) {
  for (DWORD i = 0; i < count; ++i) {
    if (components[i].handle != INVALID_HANDLE_VALUE) return false;
  }
  return true;
}

bool same_held_identity(const HeldFileIdentity& a, const HeldFileIdentity& b) {
  return a.id.VolumeSerialNumber == b.id.VolumeSerialNumber &&
      std::memcmp(a.id.FileId.Identifier, b.id.FileId.Identifier, sizeof(a.id.FileId.Identifier)) == 0 &&
      a.size.QuadPart == b.size.QuadPart &&
      a.basic.CreationTime.QuadPart == b.basic.CreationTime.QuadPart &&
      a.basic.LastWriteTime.QuadPart == b.basic.LastWriteTime.QuadPart &&
      a.basic.ChangeTime.QuadPart == b.basic.ChangeTime.QuadPart &&
      a.basic.FileAttributes == b.basic.FileAttributes;
}

// Only canonical absolute drive paths are accepted. Each prefix is opened
// without following its final reparse point and checked against its exact final
// DOS path. This does not prove directory-entry linkage against concurrent
// mutation: independent exclusion/ACL and loader qualification are required.
[[maybe_unused]] bool hold_path_components(const wchar_t* path, DWORD length,
                                           HeldPathBudget& budget, DWORD* held) {
  if (!held || !path || !budget.components || !budget.path_workspace ||
      !budget.remaining_opens || !budget.remaining_handles || !budget.remaining_observations || !budget.capacity || length < 4 || length >= 32767 ||
      budget.remaining_opens == budget.remaining_handles || budget.remaining_opens == budget.remaining_observations ||
      budget.remaining_handles == budget.remaining_observations ||
      budget.path_capacity < 2 * length + 6 || path[length] != L'\0' ||
      !((path[0] >= L'A' && path[0] <= L'Z') || (path[0] >= L'a' && path[0] <= L'z')) ||
      path[1] != L':' || path[2] != L'\\' || path[length - 1] == L'\\') return false;
  DWORD count = 1;
  for (DWORD i = 3, start = 3; i <= length; ++i) {
    const wchar_t c = path[i];
    if (i < length && (c == L'/' || c == L':' || c == L'\0')) return false;
    if (i == length || c == L'\\') {
      if (i == start || (i - start == 1 && path[start] == L'.') ||
          (i - start == 2 && path[start] == L'.' && path[start + 1] == L'.') ||
          path[i - 1] == L'.' || path[i - 1] == L' ') return false;
      if (count == MAXDWORD) return false;
      ++count; start = i + 1;
    }
  }
  if (count > budget.capacity || *budget.remaining_opens < count || *budget.remaining_handles < count ||
      *budget.remaining_observations < count || !held_path_slots_empty(budget.components, count)) return false;
  *held = 0;
  // Root is a separate component; all later components include their parents.
  for (DWORD end = 3, index = 0; index < count; ++index) {
    if (index) {
      while (end < length && path[end] != L'\\') ++end;
    }
    std::memcpy(budget.path_workspace, path, end * sizeof(wchar_t));
    budget.path_workspace[end] = L'\0';
    --*budget.remaining_opens; // failed opens are spent too
    --*budget.remaining_handles; // reservation is spent even if the open fails
    HANDLE handle = open_candidate(budget.path_workspace);
    if (handle == INVALID_HANDLE_VALUE) return false;
    budget.components[index].handle = handle;
    *held = index + 1; // caller closes even on failure
    HeldFileIdentity identity{};
    --*budget.remaining_observations;
    if (!inspect_held_file(handle, &identity)) return false;
    // The root final path includes its trailing slash; all other paths match
    // the exact normalized spelling supplied by the qualified manifest.
    wchar_t* final_path = budget.path_workspace + end + 1;
    DWORD available = budget.path_capacity - end - 1;
    DWORD n = GetFinalPathNameByHandleW(handle, final_path, available,
                                        FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    if (!n || n >= available || n != end + 4 ||
        std::wcsncmp(final_path, L"\\\\?\\", 4) != 0 ||
        std::wcsncmp(final_path + 4, path, end) != 0) return false;
    if (index + 1 < count && !(identity.basic.FileAttributes & FILE_ATTRIBUTE_DIRECTORY)) return false;
    if (index + 1 == count && (identity.basic.FileAttributes & FILE_ATTRIBUTE_DIRECTORY)) return false;
    budget.components[index].identity = identity;
    if (index && end < length) ++end;
  }
  return true;
}

[[maybe_unused]] bool held_components_current(const HeldPathComponent* components, DWORD count,
                                               ULONGLONG* remaining_observations) {
  if (!components || !count || !remaining_observations || *remaining_observations < count) return false;
  for (DWORD i = 0; i < count; ++i) {
    HeldFileIdentity current{};
    --*remaining_observations;
    if (!inspect_held_file(components[i].handle, &current) ||
        !same_held_identity(components[i].identity, current)) return false;
  }
  return true;
}

// This is an expected identity decoded from an authenticated, immutable
// manifest by a future verifier. Supplying this structure is not authentication.
struct ExpectedHeldFile {
  HeldFileIdentity identity;
  BYTE sha256[32];
};
struct HeldHashBudget {
  BYTE* read_workspace;
  DWORD read_workspace_bytes;
  BYTE* hash_object_workspace;
  DWORD hash_object_bytes;
  ULONGLONG* remaining_read_calls;
  ULONGLONG* remaining_read_bytes;
  ULONGLONG* remaining_hash_calls;
  ULONGLONG* remaining_observations;
  ULONGLONG qualified_stack_bytes;
  ULONGLONG required_stack_bytes;
};

// Observation only. The provider, its SHA-256 algorithm, workspaces, stack,
// exclusive file cursor and all counter origins require independent external
// qualification. A successful digest does not prove loader currentness.
[[maybe_unused]] bool hash_expected_held_file(HANDLE file, BCRYPT_ALG_HANDLE sha256,
                                              const ExpectedHeldFile& expected,
                                              HeldHashBudget& budget) {
  if (!file || file == INVALID_HANDLE_VALUE || !sha256 || !budget.read_workspace ||
      !budget.read_workspace_bytes || !budget.hash_object_workspace || !budget.hash_object_bytes ||
      !budget.remaining_read_calls || !budget.remaining_read_bytes || !budget.remaining_hash_calls ||
      !budget.remaining_observations || *budget.remaining_observations < 2 ||
      budget.remaining_read_calls == budget.remaining_read_bytes ||
      budget.remaining_read_calls == budget.remaining_hash_calls ||
      budget.remaining_read_calls == budget.remaining_observations ||
      budget.remaining_read_bytes == budget.remaining_hash_calls ||
      budget.remaining_read_bytes == budget.remaining_observations ||
      budget.remaining_hash_calls == budget.remaining_observations ||
      !budget.required_stack_bytes || budget.qualified_stack_bytes < budget.required_stack_bytes ||
      expected.identity.size.QuadPart < 0 ||
      (expected.identity.basic.FileAttributes & FILE_ATTRIBUTE_DIRECTORY)) return false;
  const ULONGLONG size = static_cast<ULONGLONG>(expected.identity.size.QuadPart);
  const ULONGLONG chunks = size / budget.read_workspace_bytes +
      (size % budget.read_workspace_bytes != 0 ? 1 : 0);
  if (chunks > UINT64_MAX - 3 || *budget.remaining_read_calls < chunks ||
      *budget.remaining_read_bytes < size || *budget.remaining_hash_calls < chunks + 3) return false;
  HeldFileIdentity before{};
  --*budget.remaining_observations;
  if (!inspect_held_file(file, &before) || !same_held_identity(expected.identity, before)) return false;
  LARGE_INTEGER zero{};
  if (!SetFilePointerEx(file, zero, nullptr, FILE_BEGIN)) return false;
  BCRYPT_HASH_HANDLE hash = nullptr;
  --*budget.remaining_hash_calls;
  if (BCryptCreateHash(sha256, &hash, budget.hash_object_workspace, budget.hash_object_bytes,
                       nullptr, 0, 0) < 0) return false;
  bool ok = true;
  ULONGLONG left = size;
  while (ok && left) {
    DWORD request = left < budget.read_workspace_bytes ? static_cast<DWORD>(left) : budget.read_workspace_bytes;
    DWORD received = 0;
    --*budget.remaining_read_calls;
    *budget.remaining_read_bytes -= request;
    if (!ReadFile(file, budget.read_workspace, request, &received, nullptr) || received != request) {
      ok = false; break;
    }
    --*budget.remaining_hash_calls;
    if (BCryptHashData(hash, budget.read_workspace, received, 0) < 0) { ok = false; break; }
    left -= received;
  }
  BYTE digest[32]{};
  if (ok) {
    --*budget.remaining_hash_calls;
    ok = BCryptFinishHash(hash, digest, sizeof(digest), 0) >= 0 &&
         std::memcmp(digest, expected.sha256, sizeof(digest)) == 0;
  }
  --*budget.remaining_hash_calls;
  if (BCryptDestroyHash(hash) < 0) ok = false;
  HeldFileIdentity after{};
  --*budget.remaining_observations;
  return ok && inspect_held_file(file, &after) && same_held_identity(before, after);
}

// Reopening a pathname or comparing held-object metadata cannot establish the
// current parent/entry relationship. No platform linkage protocol is qualified.
[[maybe_unused]] bool qualified_directory_entry_linkage() { return false; }

SERVICE_STATUS_HANDLE status_handle = nullptr;
void WINAPI service_control(DWORD) {}
void WINAPI service_main(DWORD, wchar_t**) {
  status_handle = RegisterServiceCtrlHandlerW(kService, service_control);
  if (!status_handle) return;
  SERVICE_STATUS status{};
  status.dwServiceType = SERVICE_WIN32_OWN_PROCESS;
  status.dwCurrentState = SERVICE_STOPPED;
  status.dwWin32ExitCode = ERROR_SERVICE_SPECIFIC_ERROR;
  status.dwServiceSpecificExitCode = ERROR_ACCESS_DENIED;
  // No start receipt verifier or externally qualified trust chain exists yet.
  // Never inspect, launch, consume a fence, or report a successful start.
  SetServiceStatus(status_handle, &status);
}
}

int wmain() {
  SERVICE_TABLE_ENTRYW table[] = {{const_cast<wchar_t*>(kService), service_main}, {nullptr, nullptr}};
  return StartServiceCtrlDispatcherW(table) ? 0 : static_cast<int>(ERROR_ACCESS_DENIED);
}
#else
// PRO273 private native primitives. Source-only: the remaining ABI and the
// qualified build/install boundary must be completed before this can be used.
extern "C" {
#include "postgres.h"
#include "fmgr.h"
#include "utils/builtins.h"
#include "utils/memutils.h"
#include "utils/jsonb.h"
#include "utils/pg_locale.h"
#include "catalog/pg_collation.h"
PG_MODULE_MAGIC;
}
#include <cmath>
#include <cstdint>
#include <cstring>
#include <cfenv>
#include <limits>
#include <unicode/unorm2.h>
#include <unicode/ustring.h>
#include <unicode/uchar.h>
#include <unicode/ucol.h>
#include <unicode/uversion.h>
#include <double-conversion/double-conversion.h>

static_assert(sizeof(double) == 8 && std::numeric_limits<double>::is_iec559,
              "PRO273 requires IEEE-754 binary64");

// All locals across PostgreSQL calls below are trivially destructible. No C++
// exception or unmanaged allocation crosses a PostgreSQL longjmp boundary.
static double read_binary64(bytea *value) {
  if (VARSIZE_ANY_EXHDR(value) != 8)
    ereport(ERROR, (errmsg("invalid PRO273 binary64 operand")));
  const auto *bytes = reinterpret_cast<const unsigned char *>(VARDATA_ANY(value));
  std::uint64_t bits = 0;
  for (int i = 0; i < 8; ++i) bits = (bits << 8) | bytes[i];
  double result;
  std::memcpy(&result, &bits, sizeof(result));
  return result;
}
static bytea *write_binary64(double value) {
  std::uint64_t bits;
  std::memcpy(&bits, &value, sizeof(bits));
  auto *result = reinterpret_cast<bytea *>(palloc(VARHDRSZ + 8));
  SET_VARSIZE(result, VARHDRSZ + 8);
  auto *bytes = reinterpret_cast<unsigned char *>(VARDATA(result));
  for (int i = 7; i >= 0; --i) { bytes[i] = static_cast<unsigned char>(bits); bits >>= 8; }
  return result;
}
static void require_round_to_nearest() {
  if (std::fegetround() != FE_TONEAREST)
    ereport(ERROR, (errmsg("PRO273 floating point mode unavailable")));
}
static bool op_is(text *value, const char *literal) {
  const size_t n = std::strlen(literal);
  return static_cast<size_t>(VARSIZE_ANY_EXHDR(value)) == n &&
         std::memcmp(VARDATA_ANY(value), literal, n) == 0;
}
extern "C" {
PG_FUNCTION_INFO_V1(pro273_prim_f64);
Datum pro273_prim_f64(PG_FUNCTION_ARGS) {
  require_round_to_nearest();
  text *operation = PG_GETARG_TEXT_PP(0);
  double a = read_binary64(PG_GETARG_BYTEA_PP(1));
  double b = read_binary64(PG_GETARG_BYTEA_PP(2));
  double result;
  if (op_is(operation, "ADD")) result = a + b;
  else if (op_is(operation, "SUB")) result = a - b;
  else if (op_is(operation, "MUL")) result = a * b;
  else if (op_is(operation, "DIV")) result = a / b;
  else if (op_is(operation, "REM")) result = std::fmod(a, b);
  else if (op_is(operation, "MIN") || op_is(operation, "MAX")) {
    const bool minimum = op_is(operation, "MIN");
    if (std::isnan(a) || std::isnan(b)) result = std::numeric_limits<double>::quiet_NaN();
    else if (a == 0.0 && b == 0.0)
      result = minimum ? (std::signbit(a) || std::signbit(b) ? -0.0 : 0.0)
                       : (std::signbit(a) && std::signbit(b) ? -0.0 : 0.0);
    else result = minimum ? (a < b ? a : b) : (a > b ? a : b);
  } else ereport(ERROR, (errmsg("invalid PRO273 binary64 operation")));
  PG_RETURN_BYTEA_P(write_binary64(result));
}
PG_FUNCTION_INFO_V1(pro273_prim_f64_unary);
Datum pro273_prim_f64_unary(PG_FUNCTION_ARGS) {
  require_round_to_nearest();
  text *operation = PG_GETARG_TEXT_PP(0);
  double a = read_binary64(PG_GETARG_BYTEA_PP(1));
  double result;
  if (op_is(operation, "FLOOR")) result = std::floor(a);
  else if (op_is(operation, "CEIL")) result = std::ceil(a);
  else if (op_is(operation, "TRUNC")) result = std::trunc(a);
  else if (op_is(operation, "ABS")) result = std::fabs(a);
  else if (op_is(operation, "SIGN")) result = std::isnan(a) || a == 0.0 ? a : (a < 0 ? -1.0 : 1.0);
  else ereport(ERROR, (errmsg("invalid PRO273 unary operation")));
  PG_RETURN_BYTEA_P(write_binary64(result));
}
}

// Explicit lengths preserve NUL and unpaired UTF-16 code units. These helpers
// are private and require the caller's independently qualified ICU profile.
static UChar *read_units(bytea *value, int32_t *length) {
  Size bytes = VARSIZE_ANY_EXHDR(value);
  if ((bytes & 1) || bytes / 2 > static_cast<Size>(INT32_MAX))
    ereport(ERROR, (errmsg("invalid PRO273 UTF-16 operand")));
  *length = static_cast<int32_t>(bytes / 2);
  UChar *out = static_cast<UChar *>(palloc((static_cast<Size>(*length) + 1) * sizeof(UChar)));
  const auto *in = reinterpret_cast<const unsigned char *>(VARDATA_ANY(value));
  for (int32_t i = 0; i < *length; ++i)
    out[i] = static_cast<UChar>((static_cast<unsigned>(in[static_cast<Size>(i)*2]) << 8) | in[static_cast<Size>(i)*2+1]);
  out[*length] = 0;
  return out;
}
static bytea *write_units(const UChar *units, int32_t length) {
  if (length < 0 || static_cast<Size>(length) > (MaxAllocSize - VARHDRSZ) / 2)
    ereport(ERROR, (errmsg("PRO273 Unicode result unavailable")));
  auto *out = reinterpret_cast<bytea *>(palloc(VARHDRSZ + static_cast<Size>(length) * 2));
  SET_VARSIZE(out, VARHDRSZ + static_cast<Size>(length) * 2);
  auto *bytes = reinterpret_cast<unsigned char *>(VARDATA(out));
  for (int32_t i = 0; i < length; ++i) {
    bytes[static_cast<Size>(i)*2] = static_cast<unsigned char>(units[i] >> 8);
    bytes[static_cast<Size>(i)*2+1] = static_cast<unsigned char>(units[i]);
  }
  return out;
}
static bytea *normalize_units(bytea *input, bool compatibility) {
  int32_t input_length;
  UChar *in = read_units(input, &input_length);
  UErrorCode status = U_ZERO_ERROR;
  const UNormalizer2 *normalizer = compatibility ? unorm2_getNFKCInstance(&status) : unorm2_getNFCInstance(&status);
  if (U_FAILURE(status)) ereport(ERROR, (errmsg("PRO273 Unicode normalization unavailable")));
  int32_t needed = unorm2_normalize(normalizer, in, input_length, nullptr, 0, &status);
  if (status != U_BUFFER_OVERFLOW_ERROR && U_FAILURE(status))
    ereport(ERROR, (errmsg("PRO273 Unicode normalization unavailable")));
  if (needed < 0 || static_cast<Size>(needed) > (MaxAllocSize / sizeof(UChar)) - 1)
    ereport(ERROR, (errmsg("PRO273 Unicode result unavailable")));
  status = U_ZERO_ERROR;
  UChar *out = static_cast<UChar *>(palloc((static_cast<Size>(needed) + 1) * sizeof(UChar)));
  int32_t actual = unorm2_normalize(normalizer, in, input_length, out, needed + 1, &status);
  if (U_FAILURE(status) || actual != needed)
    ereport(ERROR, (errmsg("PRO273 Unicode normalization unavailable")));
  return write_units(out, actual);
}
extern "C" {
PG_FUNCTION_INFO_V1(pro273_prim_nfc);
Datum pro273_prim_nfc(PG_FUNCTION_ARGS) { PG_RETURN_BYTEA_P(normalize_units(PG_GETARG_BYTEA_PP(0), false)); }
PG_FUNCTION_INFO_V1(pro273_prim_nfkc);
Datum pro273_prim_nfkc(PG_FUNCTION_ARGS) { PG_RETURN_BYTEA_P(normalize_units(PG_GETARG_BYTEA_PP(0), true)); }
PG_FUNCTION_INFO_V1(pro273_prim_upper);
Datum pro273_prim_upper(PG_FUNCTION_ARGS) {
  int32_t length;
  UChar *in = read_units(PG_GETARG_BYTEA_PP(0), &length);
  UErrorCode status = U_ZERO_ERROR;
  int32_t needed = u_strToUpper(nullptr, 0, in, length, "", &status);
  if (status != U_BUFFER_OVERFLOW_ERROR && U_FAILURE(status))
    ereport(ERROR, (errmsg("PRO273 Unicode uppercase unavailable")));
  if (needed < 0 || static_cast<Size>(needed) > (MaxAllocSize / sizeof(UChar)) - 1)
    ereport(ERROR, (errmsg("PRO273 Unicode result unavailable")));
  status = U_ZERO_ERROR;
  UChar *out = static_cast<UChar *>(palloc((static_cast<Size>(needed) + 1) * sizeof(UChar)));
  int32_t actual = u_strToUpper(out, needed + 1, in, length, "", &status);
  if (U_FAILURE(status) || actual != needed)
    ereport(ERROR, (errmsg("PRO273 Unicode uppercase unavailable")));
  PG_RETURN_BYTEA_P(write_units(out, actual));
}
}

// The grammar check is deliberately separate from conversion: the converter
// accepts forms outside JSON and must never decide this boundary by itself.
static bool json_number(const char *s, Size n) {
  Size i = 0;
  if (i < n && s[i] == '-') ++i;
  if (i == n) return false;
  if (s[i] == '0') ++i;
  else {
    if (s[i] < '1' || s[i] > '9') return false;
    do { ++i; } while (i < n && s[i] >= '0' && s[i] <= '9');
  }
  if (i < n && s[i] == '.') {
    ++i; Size first = i;
    while (i < n && s[i] >= '0' && s[i] <= '9') ++i;
    if (i == first) return false;
  }
  if (i < n && (s[i] == 'e' || s[i] == 'E')) {
    ++i; if (i < n && (s[i] == '+' || s[i] == '-')) ++i;
    Size first = i;
    while (i < n && s[i] >= '0' && s[i] <= '9') ++i;
    if (i == first) return false;
  }
  return i == n;
}
extern "C" {
PG_FUNCTION_INFO_V1(pro273_prim_number_parse);
Datum pro273_prim_number_parse(PG_FUNCTION_ARGS) {
  require_round_to_nearest();
  bytea *input = PG_GETARG_BYTEA_PP(0);
  Size length = VARSIZE_ANY_EXHDR(input);
  const char *bytes = VARDATA_ANY(input);
  if (length > INT32_MAX || !json_number(bytes, length))
    ereport(ERROR, (errmsg("invalid PRO273 JSON number")));
  int processed = 0;
  double result;
  {
    const double_conversion::StringToDoubleConverter converter(
      double_conversion::StringToDoubleConverter::NO_FLAGS, 0.0, 0.0, nullptr, nullptr);
    result = converter.StringToDouble(bytes, static_cast<int>(length), &processed);
  }
  if (processed != static_cast<int>(length))
    ereport(ERROR, (errmsg("invalid PRO273 JSON number")));
  PG_RETURN_BYTEA_P(write_binary64(result));
}
PG_FUNCTION_INFO_V1(pro273_prim_number_string);
Datum pro273_prim_number_string(PG_FUNCTION_ARGS) {
  require_round_to_nearest();
  double value = read_binary64(PG_GETARG_BYTEA_PP(0));
  char buffer[128];
  int length;
  bool ok;
  {
    double_conversion::StringBuilder builder(buffer, sizeof(buffer));
    ok = double_conversion::DoubleToStringConverter::EcmaScriptConverter().ToShortest(value, &builder);
    length = builder.position();
  }
  if (!ok || length < 0 || length >= static_cast<int>(sizeof(buffer)))
    ereport(ERROR, (errmsg("PRO273 number rendering unavailable")));
  bytea *out = reinterpret_cast<bytea *>(palloc(VARHDRSZ + length));
  SET_VARSIZE(out, VARHDRSZ + length);
  std::memcpy(VARDATA(out), buffer, length);
  PG_RETURN_BYTEA_P(out);
}
}

// This reports observable library facts only. It is not an attestation and
// cannot authorize an installation or a profile.
extern "C" {
PG_FUNCTION_INFO_V1(pro273_prim_identity);
Datum pro273_prim_identity(PG_FUNCTION_ARGS) {
  UVersionInfo icu, unicode;
  u_getVersion(icu);
  u_getUnicodeVersion(unicode);
  char icu_text[U_MAX_VERSION_STRING_LENGTH], unicode_text[U_MAX_VERSION_STRING_LENGTH];
  u_versionToString(icu, icu_text);
  u_versionToString(unicode, unicode_text);
  char json[384];
  int count = snprintf(json, sizeof(json),
    "{\"schemaVersion\":\"pro273-primitive-identity-v1\","
    "\"compiledPgVersionNum\":%d,\"compiledIcuMajor\":%d,"
    "\"icuRuntime\":[%u,%u,%u,%u],\"unicodeRuntime\":[%u,%u,%u,%u],"
    "\"icuRuntimeVersion\":\"%s\",\"unicodeRuntimeVersion\":\"%s\","
    "\"roundToNearest\":%s}",
    PG_VERSION_NUM, U_ICU_VERSION_MAJOR_NUM,
    static_cast<unsigned>(icu[0]), static_cast<unsigned>(icu[1]),
    static_cast<unsigned>(icu[2]), static_cast<unsigned>(icu[3]),
    static_cast<unsigned>(unicode[0]), static_cast<unsigned>(unicode[1]),
    static_cast<unsigned>(unicode[2]), static_cast<unsigned>(unicode[3]),
    icu_text, unicode_text, std::fegetround() == FE_TONEAREST ? "true" : "false");
  if (count < 0 || static_cast<Size>(count) >= sizeof(json))
    ereport(ERROR, (errmsg("PRO273 identity unavailable")));
  PG_RETURN_DATUM(DirectFunctionCall1(jsonb_in, CStringGetDatum(json)));
}
}

// PostgreSQL's ICU collation object must match the independently qualified
// server-internal ABI and current protected collation OID before this call.
extern "C" {
PG_FUNCTION_INFO_V1(pro273_prim_compare);
Datum pro273_prim_compare(PG_FUNCTION_ARGS) {
  int32_t left_length, right_length;
  UChar *left = read_units(PG_GETARG_BYTEA_PP(0), &left_length);
  UChar *right = read_units(PG_GETARG_BYTEA_PP(1), &right_length);
  Oid collation = PG_GETARG_OID(2);
  if (!OidIsValid(collation))
    ereport(ERROR, (errmsg("PRO273 collation unavailable")));
  pg_locale_t locale = pg_newlocale_from_collation(collation);
  if (!locale || locale->provider != COLLPROVIDER_ICU || !locale->info.icu.ucol)
    ereport(ERROR, (errmsg("PRO273 ICU collation unavailable")));
  UCollationResult result = ucol_strcoll(locale->info.icu.ucol, left, left_length, right, right_length);
  PG_RETURN_INT32(result < 0 ? -1 : result > 0 ? 1 : 0);
}
}
#endif // PRO273_INSTALLER_ROOT
