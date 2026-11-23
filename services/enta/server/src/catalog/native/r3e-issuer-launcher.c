#define _GNU_SOURCE
#define main r3e_custody_unused_entry
#include "r3e-custody.c"
#undef main

#include <dirent.h>
#include <grp.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/fsuid.h>
#include <sys/statvfs.h>

#ifndef R3E_ISSUER_UID
#error "R3E_ISSUER_UID must be pinned at build time"
#endif
#ifndef R3E_ISSUER_GID
#error "R3E_ISSUER_GID must be pinned at build time"
#endif
#ifndef R3E_EXPECTED_CGROUP
#error "R3E_EXPECTED_CGROUP must be pinned at build time"
#endif
#ifndef R3E_PACKAGE_ROOT
#error "R3E_PACKAGE_ROOT must be pinned at build time"
#endif
#ifndef R3E_MANIFEST_PATH
#error "R3E_MANIFEST_PATH must be pinned at build time"
#endif
#ifndef R3E_MANIFEST_SHA256
#error "R3E_MANIFEST_SHA256 must be pinned at build time"
#endif
#ifndef R3E_NODE_PATH
#error "R3E_NODE_PATH must be pinned at build time"
#endif
#ifndef R3E_CLI_PATH
#error "R3E_CLI_PATH must be pinned at build time"
#endif
#ifndef R3E_BOOTSTRAP_PATH
#error "R3E_BOOTSTRAP_PATH must be pinned at build time"
#endif
#ifndef R3E_HELPER_PATH
#error "R3E_HELPER_PATH must be pinned at build time"
#endif
#ifndef R3E_LOADER_PATH
#error "R3E_LOADER_PATH must be pinned at build time"
#endif
#ifndef R3E_LIBRARY_PATH
#error "R3E_LIBRARY_PATH must be pinned at build time"
#endif
#ifndef R3E_LAUNCHER_PATH
#error "R3E_LAUNCHER_PATH must be pinned at build time"
#endif

#define MAX_MANIFEST_BYTES (4U * 1024U * 1024U)
#define MAX_PACKAGE_FILES 16384U
#define MAX_PACKAGE_DIRS 4096U
#define MAX_PACKAGE_ENTRIES (MAX_PACKAGE_FILES + MAX_PACKAGE_DIRS)
#define MAX_PACKAGE_DEPTH 32U
#define MAX_PACKAGE_BYTES (2ULL * 1024ULL * 1024ULL * 1024ULL)
#define MAX_CONTEXT_BYTES 8192U

extern char **environ;

typedef struct {
  char kind;
  char *path;
  char digest[65];
} package_entry;

static int is_sha256(const char *value) {
  if (!value || strlen(value) != 64) return 0;
  for (size_t i = 0; i < 64; i++) {
    if (!((value[i] >= '0' && value[i] <= '9') || (value[i] >= 'a' && value[i] <= 'f'))) return 0;
  }
  return 1;
}

static int is_release_id(const char *value) {
  size_t length = value ? strlen(value) : 0;
  if (length == 0 || length > 160 || value[0] == '.' || value[length - 1] == '.') return 0;
  for (size_t i = 0; i < length; i++) {
    unsigned char c = (unsigned char)value[i];
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
          (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.')) return 0;
  }
  return 1;
}

static int path_is_inside_package(const char *path) {
  size_t path_length = strlen(path);
  size_t root_length = strlen(R3E_PACKAGE_ROOT);
  if (path_length <= root_length || strncmp(path, R3E_PACKAGE_ROOT, root_length) != 0 || path[root_length] != '/') return 0;
  if (strstr(path, "//") || strstr(path, "/./") || strstr(path, "/../") ||
      (path_length >= 3 && strcmp(path + path_length - 3, "/..") == 0) ||
      (path_length >= 2 && strcmp(path + path_length - 2, "/.") == 0)) return 0;
  return 1;
}

static int canonical_package_component(const char *name) {
  if (!name || !*name || strcmp(name, ".") == 0 || strcmp(name, "..") == 0 ||
      strchr(name, '/') || strchr(name, '\\') || strchr(name, '\t') ||
      strchr(name, '\r') || strchr(name, '\n')) return 0;
  for (const unsigned char *cursor = (const unsigned char *)name; *cursor; cursor++) {
    if (*cursor < 0x21 || *cursor > 0x7e) return 0;
  }
  return 1;
}

static int read_exact_file(int fd, const struct stat *st, char **bytes_out, size_t *length_out) {
  if (st->st_size < 1 || (uint64_t)st->st_size > MAX_MANIFEST_BYTES) return -1;
  size_t length = (size_t)st->st_size;
  char *bytes = malloc(length + 1);
  if (!bytes) return -1;
  size_t offset = 0;
  while (offset < length) {
    ssize_t amount = pread(fd, bytes + offset, length - offset, (off_t)offset);
    if (amount < 0 && errno == EINTR) continue;
    if (amount <= 0) { free(bytes); return -1; }
    offset += (size_t)amount;
  }
  struct stat after;
  if (fstat(fd, &after) != 0 || after.st_dev != st->st_dev || after.st_ino != st->st_ino ||
      after.st_size != st->st_size || after.st_mtim.tv_sec != st->st_mtim.tv_sec ||
      after.st_mtim.tv_nsec != st->st_mtim.tv_nsec || after.st_ctim.tv_sec != st->st_ctim.tv_sec ||
      after.st_ctim.tv_nsec != st->st_ctim.tv_nsec) {
    free(bytes);
    return -1;
  }
  bytes[length] = '\0';
  *bytes_out = bytes;
  *length_out = length;
  return 0;
}

static int parse_manifest(char *bytes, package_entry entries[MAX_PACKAGE_ENTRIES], size_t *count_out) {
  const char header[] = "R3E-PACKAGE-V2\n";
  if (strncmp(bytes, header, sizeof(header) - 1) != 0) return -1;
  char *line = bytes + sizeof(header) - 1;
  size_t count = 0;
  char *previous = NULL;
  while (*line) {
    char *end = strchr(line, '\n');
    if (!end) return -1;
    *end = '\0';
    char *first_tab = strchr(line, '\t');
    if (!first_tab || first_tab == line) return -1;
    *first_tab = '\0';
    char kind = line[0];
    char *path = first_tab + 1;
    const char *digest = NULL;
    if (kind == 'F') {
      char *second_tab = strchr(path, '\t');
      if (!second_tab || second_tab == path || strchr(second_tab + 1, '\t')) return -1;
      *second_tab = '\0';
      digest = path;
      path = second_tab + 1;
      if (!is_sha256(digest)) return -1;
    } else if (kind != 'D' || strchr(path, '\t')) {
      return -1;
    }
    if (!path_is_inside_package(path) || strlen(path) >= MAX_PATH_BYTES ||
        count >= MAX_PACKAGE_ENTRIES || (previous && strcmp(previous, path) >= 0) ||
        strcmp(path, R3E_MANIFEST_PATH) == 0 || strcmp(path, R3E_LAUNCHER_PATH) == 0) return -1;
    const char *relative = path + strlen(R3E_PACKAGE_ROOT) + 1;
    if (!*relative || strlen(relative) > MAX_PATH_BYTES) return -1;
    char component_copy[MAX_PATH_BYTES + 1];
    memcpy(component_copy, relative, strlen(relative) + 1);
    char *component_save = NULL;
    unsigned depth = 0;
    for (char *component = strtok_r(component_copy, "/", &component_save); component;
         component = strtok_r(NULL, "/", &component_save)) {
      if (!canonical_package_component(component) || ++depth > MAX_PACKAGE_DEPTH) return -1;
    }
    if (depth == 0) return -1;
    entries[count].kind = kind;
    if (digest) memcpy(entries[count].digest, digest, 65);
    else entries[count].digest[0] = '\0';
    entries[count].path = path;
    previous = path;
    count++;
    line = end + 1;
  }
  if (count == 0) return -1;
  *count_out = count;
  return 0;
}

static const char *manifest_digest_for(const package_entry *entries, size_t count, const char *path) {
  for (size_t i = 0; i < count; i++) if (entries[i].kind == 'F' && strcmp(entries[i].path, path) == 0) return entries[i].digest;
  return NULL;
}

static const package_entry *manifest_entry_for(const package_entry *entries, size_t count, char kind, const char *path) {
  size_t low = 0, high = count;
  while (low < high) {
    size_t middle = low + (high - low) / 2;
    int comparison = strcmp(entries[middle].path, path);
    if (comparison == 0) return entries[middle].kind == kind ? &entries[middle] : NULL;
    if (comparison < 0) low = middle + 1;
    else high = middle;
  }
  return NULL;
}

static int open_root_relative(int rootfd, uint64_t root_mount, const char *path, struct stat *st, char digest[65]) {
  if (!path || path[0] != '/' || strlen(path) >= MAX_PATH_BYTES || strstr(path, "//")) return -1;
  int fd = openat2_one(rootfd, path + 1, O_RDONLY | O_CLOEXEC);
  if (fd < 0) return -1;
  int result = -1;
  if (check_component(fd, root_mount, 1, st) == 0 && sha256_open_file(fd, st, digest) == 0) result = fd;
  if (result < 0) close(fd);
  return result;
}

static int verify_entries(int rootfd, uint64_t root_mount, const package_entry *entries, size_t count) {
  for (size_t i = 0; i < count; i++) {
    struct stat st;
    if (entries[i].kind == 'D') {
      int fd = openat2_one(rootfd, entries[i].path + 1, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
      int ok = fd >= 0 && check_component(fd, root_mount, 0, &st) == 0;
      if (fd >= 0) close(fd);
      if (!ok) return -1;
    } else {
      char digest[65];
      if (inspect_path(rootfd, root_mount, entries[i].path, &st, digest) != 0 || strcmp(digest, entries[i].digest) != 0) return -1;
    }
  }
  return 0;
}

typedef struct {
  const package_entry *entries;
  size_t entry_count;
  size_t files;
  size_t directories;
  uint64_t total_bytes;
  uint64_t root_mount;
  int manifest_seen;
  int launcher_seen;
  char launcher_digest[65];
} package_inventory;

static int scan_package_directory(package_inventory *inventory, int directory_fd, const char *relative, unsigned depth) {
  if (depth > MAX_PACKAGE_DEPTH) return -1;
  /* dup() shares the directory stream offset and makes the pre-exec rescan
   * observe EOF. Reopen "." relative to the already verified directory to
   * obtain an independent, no-follow stream for every inventory pass. */
  int scan_fd = openat(directory_fd, ".", O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (scan_fd < 0) return -1;
  DIR *directory = fdopendir(scan_fd);
  if (!directory) { close(scan_fd); return -1; }
  struct dirent *item;
  int result = -1;
  while ((item = readdir(directory)) != NULL) {
    if (strcmp(item->d_name, ".") == 0 || strcmp(item->d_name, "..") == 0) continue;
    if (!canonical_package_component(item->d_name)) goto done;
    char child_relative[MAX_PATH_BYTES + 1];
    int child_length = relative[0]
      ? snprintf(child_relative, sizeof(child_relative), "%s/%s", relative, item->d_name)
      : snprintf(child_relative, sizeof(child_relative), "%s", item->d_name);
    if (child_length <= 0 || child_length >= (int)sizeof(child_relative)) goto done;
    char child_absolute[MAX_PATH_BYTES + 1];
    int absolute_length = snprintf(child_absolute, sizeof(child_absolute), "%s/%s", R3E_PACKAGE_ROOT, child_relative);
    if (absolute_length <= 0 || absolute_length >= (int)sizeof(child_absolute)) goto done;

    struct stat nofollow_stat;
    if (fstatat(dirfd(directory), item->d_name, &nofollow_stat, AT_SYMLINK_NOFOLLOW) != 0 ||
        S_ISLNK(nofollow_stat.st_mode)) goto done;
    if (S_ISDIR(nofollow_stat.st_mode)) {
      const package_entry *entry = manifest_entry_for(inventory->entries, inventory->entry_count, 'D', child_absolute);
      int child_fd = openat2_one(dirfd(directory), item->d_name, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
      struct stat opened_stat;
      if (!entry || child_fd < 0 || check_component(child_fd, inventory->root_mount, 0, &opened_stat) != 0 ||
          ++inventory->directories > MAX_PACKAGE_DIRS) {
        if (child_fd >= 0) close(child_fd);
        goto done;
      }
      int child_result = scan_package_directory(inventory, child_fd, child_relative, depth + 1);
      close(child_fd);
      if (child_result != 0) goto done;
    } else if (S_ISREG(nofollow_stat.st_mode)) {
      struct stat opened_stat;
      char digest[65];
      int child_fd = openat2_one(dirfd(directory), item->d_name, O_RDONLY | O_CLOEXEC);
      if (child_fd < 0 || check_component(child_fd, inventory->root_mount, 1, &opened_stat) != 0 ||
          sha256_open_file(child_fd, &opened_stat, digest) != 0) {
        if (child_fd >= 0) close(child_fd);
        goto done;
      }
      close(child_fd);
      if (strcmp(child_absolute, R3E_MANIFEST_PATH) == 0) {
        if (inventory->manifest_seen || strcmp(digest, R3E_MANIFEST_SHA256) != 0) goto done;
        inventory->manifest_seen = 1;
      } else if (strcmp(child_absolute, R3E_LAUNCHER_PATH) == 0) {
        if (inventory->launcher_seen || strcmp(digest, inventory->launcher_digest) != 0) goto done;
        inventory->launcher_seen = 1;
      } else {
        const package_entry *entry = manifest_entry_for(inventory->entries, inventory->entry_count, 'F', child_absolute);
        if (!entry || strcmp(digest, entry->digest) != 0 || ++inventory->files > MAX_PACKAGE_FILES) goto done;
      }
      if (opened_stat.st_size < 0 || UINT64_MAX - inventory->total_bytes < (uint64_t)opened_stat.st_size) goto done;
      inventory->total_bytes += (uint64_t)opened_stat.st_size;
      if (inventory->total_bytes > MAX_PACKAGE_BYTES) goto done;
    } else {
      goto done;
    }
  }
  result = 0;
done:
  closedir(directory);
  return result;
}

static int verify_package_tree(int package_fd, uint64_t root_mount, const package_entry *entries, size_t count,
                               const char launcher_digest[65]) {
  package_inventory inventory = {
    .entries = entries,
    .entry_count = count,
    .root_mount = root_mount,
  };
  memcpy(inventory.launcher_digest, launcher_digest, 65);
  if (scan_package_directory(&inventory, package_fd, "", 0) != 0 || !inventory.manifest_seen || !inventory.launcher_seen ||
      inventory.files + inventory.directories != count) return -1;
  return 0;
}

static int check_environment(void) {
  size_t count = 0;
  for (char **item = environ; item && *item; item++) {
    const char *equals = strchr(*item, '=');
    size_t length = equals ? (size_t)(equals - *item) : strlen(*item);
    const char *name = *item;
    if (!equals || length != 13 || strncmp(name, "INVOCATION_ID", 13) != 0) return -1;
    count++;
  }
  const char *invocation_id = getenv("INVOCATION_ID");
  if (count != 1 || !invocation_id || strlen(invocation_id) != 32) return -1;
  for (size_t i = 0; i < 32; i++) {
    if (!((invocation_id[i] >= '0' && invocation_id[i] <= '9') ||
          (invocation_id[i] >= 'a' && invocation_id[i] <= 'f'))) return -1;
  }
  return 0;
}

static int no_unexpected_descriptors(void) {
  DIR *directory = opendir("/proc/self/fd");
  if (!directory) return -1;
  int directory_fd = dirfd(directory);
  struct dirent *entry;
  int result = 0;
  while ((entry = readdir(directory)) != NULL) {
    if (entry->d_name[0] == '.') continue;
    char *end = NULL;
    long descriptor = strtol(entry->d_name, &end, 10);
    if (!end || *end != '\0') { result = -1; break; }
    if (descriptor <= 2 || descriptor == directory_fd) continue;
    if (fcntl((int)descriptor, F_GETFD) >= 0 || errno != EBADF) { result = -1; break; }
  }
  closedir(directory);
  return result;
}

static int check_capabilities_and_nnp(void) {
  FILE *status = fopen("/proc/self/status", "r");
  if (!status) return -1;
  char *line = NULL;
  size_t capacity = 0;
  const char *labels[] = { "CapEff:", "CapPrm:", "CapInh:", "CapAmb:", "CapBnd:", "NoNewPrivs:" };
  unsigned seen = 0;
  int ok = 1;
  while (getline(&line, &capacity, status) >= 0) {
    for (size_t i = 0; i < sizeof(labels) / sizeof(labels[0]); i++) {
      size_t n = strlen(labels[i]);
      if (strncmp(line, labels[i], n) == 0) {
        char *end = NULL;
        unsigned long long value = strtoull(line + n, &end, i == 5 ? 10 : 16);
        if (end == line + n || value != (i == 5 ? 1ULL : 0ULL)) ok = 0;
        seen++;
      }
    }
  }
  free(line);
  fclose(status);
  return ok && seen == sizeof(labels) / sizeof(labels[0]) && prctl(PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) == 1 ? 0 : -1;
}

static int check_identity(void) {
  uid_t ruid, euid, suid;
  gid_t rgid, egid, sgid;
  if (getresuid(&ruid, &euid, &suid) != 0 || getresgid(&rgid, &egid, &sgid) != 0 ||
      ruid != R3E_ISSUER_UID || euid != R3E_ISSUER_UID || suid != R3E_ISSUER_UID ||
      rgid != R3E_ISSUER_GID || egid != R3E_ISSUER_GID || sgid != R3E_ISSUER_GID ||
      setfsuid((uid_t)-1) != R3E_ISSUER_UID || setfsgid((gid_t)-1) != R3E_ISSUER_GID) return -1;
  gid_t groups[4];
  int group_count = getgroups(4, groups);
  if (group_count != 1 || groups[0] != R3E_ISSUER_GID) return -1;
  return check_capabilities_and_nnp();
}

static int check_service_context(void) {
  if (getppid() != 1) return -1;

  FILE *cgroup = fopen("/proc/self/cgroup", "r");
  if (!cgroup) return -1;
  char line[512] = {0}, extra[512] = {0};
  int first = fscanf(cgroup, "%511[^\n]\n", line);
  int second = fscanf(cgroup, "%511[^\n]", extra);
  fclose(cgroup);
  char expected[512];
  int expected_length = snprintf(expected, sizeof(expected), "0::%s", R3E_EXPECTED_CGROUP);
  return first == 1 && second == EOF && expected_length > 0 && expected_length < (int)sizeof(expected) && strcmp(line, expected) == 0 ? 0 : -1;
}

static int decode_mount_path(const char *input, char output[MAX_PATH_BYTES + 1]) {
  size_t used = 0;
  for (size_t i = 0; input[i]; i++) {
    unsigned char value = (unsigned char)input[i];
    if (value == '\\') {
      if (input[i + 1] != '0' || input[i + 2] != '4' || input[i + 3] != '0') return -1;
      value = ' ';
      i += 3;
    }
    if (value == '\0' || used >= MAX_PATH_BYTES) return -1;
    output[used++] = (char)value;
  }
  output[used] = '\0';
  return used > 0 && output[0] == '/' ? 0 : -1;
}

static int mountpoint_prefix(const char *path, const char *prefix) {
  size_t length = strlen(prefix);
  return strncmp(path, prefix, length) == 0 && (path[length] == '\0' || path[length] == '/');
}

typedef struct {
  const char *path;
  const char *filesystem;
  const char *source;
  const char *mount_allowed;
  const char *mount_required;
  const char *super_allowed;
  const char *super_required;
} allowed_mount;

static int option_matches_pattern(const char *option, const char *pattern) {
  if (strcmp(option, pattern) == 0) return 1;
  const char *equals = strchr(pattern, '=');
  if (!equals || strncmp(option, pattern, (size_t)(equals - pattern + 1)) != 0) return 0;
  const char *value = option + (equals - pattern + 1);
  if (strcmp(pattern, "size=@k") == 0) {
    size_t length = strlen(value);
    if (length < 2 || value[length - 1] != 'k') return 0;
    for (size_t i = 0; i + 1 < length; i++) if (value[i] < '0' || value[i] > '9') return 0;
    return 1;
  }
  if (strcmp(pattern, "nr_inodes=@decimal") == 0 || strcmp(pattern, "mode=@octal") == 0 || strcmp(pattern, "gid=@decimal") == 0) {
    if (!*value) return 0;
    for (const char *cursor = value; *cursor; cursor++) {
      if (strcmp(pattern, "mode=@octal") == 0 ? (*cursor < '0' || *cursor > '7') : (*cursor < '0' || *cursor > '9')) return 0;
    }
    return 1;
  }
  return 0;
}

static int option_list_matches(const char *actual, const char *allowed, const char *required) {
  if (!actual || !allowed || !required || strlen(actual) > 2048 || strlen(allowed) > 2048 || strlen(required) > 2048) return 0;
  char actual_copy[2049], allowed_copy[2049], required_copy[2049];
  memcpy(actual_copy, actual, strlen(actual) + 1);
  memcpy(allowed_copy, allowed, strlen(allowed) + 1);
  memcpy(required_copy, required, strlen(required) + 1);
  const char *actual_options[32]; size_t actual_count = 0;
  char *save = NULL;
  for (char *token = strtok_r(actual_copy, ",", &save); token; token = strtok_r(NULL, ",", &save)) {
    if (actual_count >= 32 || !*token) return 0;
    for (size_t i = 0; i < actual_count; i++) if (strcmp(actual_options[i], token) == 0) return 0;
    actual_options[actual_count++] = token;
    int accepted = 0;
    char allowed_iter[2049]; memcpy(allowed_iter, allowed_copy, strlen(allowed_copy) + 1);
    char *allowed_save = NULL;
    for (char *candidate = strtok_r(allowed_iter, ",", &allowed_save); candidate; candidate = strtok_r(NULL, ",", &allowed_save)) {
      if (option_matches_pattern(token, candidate)) { accepted = 1; break; }
    }
    if (!accepted) return 0;
  }
  if (actual_count == 0) return 0;
  char *required_save = NULL;
  for (char *candidate = strtok_r(required_copy, ",", &required_save); candidate; candidate = strtok_r(NULL, ",", &required_save)) {
    int found = 0;
    for (size_t i = 0; i < actual_count; i++) if (option_matches_pattern(actual_options[i], candidate)) { found = 1; break; }
    if (!found) return 0;
  }
  return 1;
}

static const allowed_mount *allowed_api_mount(const char *path) {
  static const allowed_mount mounts[] = {
    {"/dev", "devtmpfs", "none", "rw,nosuid,relatime", "rw,nosuid,relatime", "rw,size=@k,nr_inodes=@decimal,mode=@octal", "rw,size=@k,nr_inodes=@decimal,mode=@octal"},
    {"/dev/pts", "devpts", "devpts", "rw,nosuid,noexec,noatime", "rw,nosuid,noexec,noatime", "rw,gid=@decimal,mode=@octal,ptmxmode=000", "rw,gid=@decimal,mode=@octal,ptmxmode=000"},
    {"/dev/shm", "tmpfs", "tmpfs", "rw,nosuid,nodev,noatime", "rw,nosuid,nodev,noatime", "rw", "rw"},
    {"/dev/hugepages", "hugetlbfs", "hugetlbfs", "rw,nosuid,nodev,relatime", "rw,nosuid,nodev,relatime", "rw,pagesize=2M", "rw,pagesize=2M"},
    {"/dev/mqueue", "mqueue", "mqueue", "rw,nosuid,nodev,noexec,relatime", "rw,nosuid,nodev,noexec,relatime", "rw", "rw"},
    {"/proc", "proc", "proc", "rw,nosuid,nodev,noexec,relatime", "rw,nosuid,nodev,noexec,relatime", "rw,hidepid=invisible", "rw,hidepid=invisible"},
    {"/proc/sys/fs/binfmt_misc", "binfmt_misc", "binfmt_misc", "rw,nosuid,noexec,relatime", "rw,nosuid,noexec,relatime", "rw", "rw"},
    {"/run", "tmpfs", "tmpfs", "rw,nosuid,nodev", "rw,nosuid,nodev", "rw,size=@k,nr_inodes=@decimal,mode=@octal", "rw,size=@k,nr_inodes=@decimal,mode=@octal"},
    {"/run/host/.os-release-stage", "tmpfs", "tmpfs", "ro,nosuid,nodev", "ro,nosuid,nodev", "rw,mode=@octal", "rw,mode=@octal"},
    {"/run/systemd/journal/dev-log", "tmpfs", "tmpfs", "ro,nosuid,nodev,noexec", "ro,nosuid,nodev,noexec", "rw,mode=@octal", "rw,mode=@octal"},
    {"/run/systemd/journal/socket", "tmpfs", "tmpfs", "ro,nosuid,nodev,noexec", "ro,nosuid,nodev,noexec", "rw,mode=@octal", "rw,mode=@octal"},
    {"/run/systemd/journal/stdout", "tmpfs", "tmpfs", "ro,nosuid,nodev,noexec", "ro,nosuid,nodev,noexec", "rw,mode=@octal", "rw,mode=@octal"},
    {"/sys", "sysfs", "sysfs", "rw,nosuid,nodev,noexec,noatime", "rw,nosuid,nodev,noexec,noatime", "rw", "rw"},
    {"/sys/fs/cgroup", "cgroup2", "cgroup2", "rw,nosuid,nodev,noexec,relatime", "rw,nosuid,nodev,noexec,relatime", "rw,nsdelegate", "rw,nsdelegate"},
    {"/sys/kernel/tracing", "tracefs", "tracefs", "rw,nosuid,nodev,noexec,relatime", "rw,nosuid,nodev,noexec,relatime", "rw", "rw"},
    {"/sys/kernel/debug", "debugfs", "debugfs", "rw,nosuid,nodev,noexec,relatime", "rw,nosuid,nodev,noexec,relatime", "rw", "rw"},
    {"/sys/kernel/config", "configfs", "configfs", "rw,nosuid,nodev,noexec,relatime", "rw,nosuid,nodev,noexec,relatime", "rw", "rw"},
    {"/sys/fs/fuse/connections", "fusectl", "fusectl", "rw,nosuid,nodev,noexec,relatime", "rw,nosuid,nodev,noexec,relatime", "rw", "rw"},
  };
  for (size_t i = 0; i < sizeof(mounts) / sizeof(mounts[0]); i++) if (strcmp(path, mounts[i].path) == 0) return &mounts[i];
  return NULL;
}

static int source_matches(const char *mountpoint, const char *source, const char *expected) {
  if (strcmp(mountpoint, "/") == 0 && strcmp(expected, "root-image-loop") == 0) {
    const char *digits = NULL;
    if (strncmp(source, "/dev/loop", 9) == 0) digits = source + 9;
    else if (strncmp(source, "/proc/self/fd/", 14) == 0) digits = source + 14;
    if (!digits || !*digits || (*digits == '0' && digits[1])) return 0;
    for (const char *cursor = digits; *cursor; cursor++) if (*cursor < '0' || *cursor > '9') return 0;
    return 1;
  }
  /* systemd RootImage API mounts may expose `none` as their mount source;
   * retain that exact alternative only for the enumerated mountpoint/type. */
  return strcmp(source, expected) == 0 || strcmp(source, "none") == 0;
}

static int valid_mount_propagation(const char *value, int *seen_shared, int *seen_master) {
  const char *digits = NULL;
  if (strncmp(value, "shared:", 7) == 0) {
    if (*seen_shared) return 0;
    *seen_shared = 1;
    digits = value + 7;
  } else if (strncmp(value, "master:", 7) == 0) {
    if (*seen_master) return 0;
    *seen_master = 1;
    digits = value + 7;
  } else return 0;
  if (!*digits || (*digits == '0' && digits[1])) return 0;
  for (const char *cursor = digits; *cursor; cursor++) if (*cursor < '0' || *cursor > '9') return 0;
  return 1;
}

/* The immutable root image is the sole code filesystem. Permit only the
 * documented service API mounts outside it; all package reads also carry the
 * root mount ID and RESOLVE_NO_XDEV checks. */
static int verify_mount_topology(void) {
  struct statvfs root_options;
  if (statvfs("/", &root_options) != 0 || (root_options.f_flag & ST_RDONLY) == 0) return -1;
  FILE *mounts = fopen("/proc/self/mountinfo", "r");
  if (!mounts) return -1;
  char *line = NULL;
  size_t capacity = 0;
  size_t rows = 0;
  size_t root_rows = 0;
  char seen_mounts[256][MAX_PATH_BYTES + 1];
  size_t seen_mount_count = 0;
  int ok = 1;
  while (getline(&line, &capacity, mounts) >= 0) {
    if (++rows > 256 || strlen(line) > 8192) { ok = 0; break; }
    char *fields[64];
    size_t count = 0;
    char *save = NULL;
    for (char *field = strtok_r(line, " \n", &save); field; field = strtok_r(NULL, " \n", &save)) {
      if (count == sizeof(fields) / sizeof(fields[0])) { ok = 0; break; }
      fields[count++] = field;
    }
    if (!ok || count < 10) { ok = 0; break; }
    size_t separator = 6;
    while (separator < count && strcmp(fields[separator], "-") != 0) separator++;
    if (separator + 3 != count - 1 || separator > 8) { ok = 0; break; }
    int seen_shared = 0, seen_master = 0;
    for (size_t i = 6; i < separator; i++) {
      if (!valid_mount_propagation(fields[i], &seen_shared, &seen_master)) { ok = 0; break; }
    }
    if (!ok) break;
    char mountpoint[MAX_PATH_BYTES + 1];
    if (decode_mount_path(fields[4], mountpoint) != 0) { ok = 0; break; }
    const char *filesystem = fields[separator + 1];
    const char *source = fields[separator + 2];
    const char *super_options = fields[separator + 3];
    const char *mount_options = fields[5];
    for (size_t i = 0; i < seen_mount_count; i++) {
      if (strcmp(seen_mounts[i], mountpoint) == 0) { ok = 0; break; }
    }
    if (!ok || seen_mount_count >= 256) { ok = 0; break; }
    memcpy(seen_mounts[seen_mount_count++], mountpoint, strlen(mountpoint) + 1);
    if (strcmp(mountpoint, "/") == 0) {
      if (strcmp(filesystem, "ext4") != 0 || !source_matches(mountpoint, source, "root-image-loop") ||
          !option_list_matches(mount_options, "ro,nodev,relatime", "ro,nodev,relatime") ||
          !option_list_matches(super_options, "ro", "ro")) { ok = 0; break; }
      root_rows++;
    } else {
      const allowed_mount *policy = allowed_api_mount(mountpoint);
      if (!policy || strcmp(filesystem, policy->filesystem) != 0 || !source_matches(mountpoint, source, policy->source) ||
          !option_list_matches(mount_options, policy->mount_allowed, policy->mount_required) ||
          !option_list_matches(super_options, policy->super_allowed, policy->super_required)) { ok = 0; break; }
    }
    if (mountpoint_prefix(mountpoint, R3E_PACKAGE_ROOT) && strcmp(mountpoint, R3E_PACKAGE_ROOT) != 0) {
      ok = 0;
      break;
    }
  }
  free(line);
  fclose(mounts);
  return ok && rows > 0 && root_rows == 1 ? 0 : -1;
}

static int is_manifest_path(const char *candidate, const package_entry *entries, size_t count) {
  return manifest_digest_for(entries, count, candidate) != NULL;
}

static void launch_denied(int code) {
  dprintf(STDERR_FILENO, "R3E_LAUNCH_DENIED:%d\n", code);
}

int main(int argc, char **argv) {
  if (argc != 2 || !is_release_id(argv[1])) { launch_denied(64); return 64; }
  if (check_identity() != 0) { launch_denied(65); return 65; }
  if (check_service_context() != 0) { launch_denied(66); return 66; }
  if (check_environment() != 0) { launch_denied(67); return 67; }
  if (verify_mount_topology() != 0) { launch_denied(67); return 67; }
  if (no_unexpected_descriptors() != 0) { launch_denied(68); return 68; }

  int rootfd = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  struct statfs rootfs;
  uint64_t root_mount = 0;
  if (rootfd < 0 || fstatfs(rootfd, &rootfs) != 0 || (uint64_t)rootfs.f_type != (uint64_t)EXT4_SUPER_MAGIC ||
      statx_mount_id(rootfd, &root_mount) != 0) { if (rootfd >= 0) close(rootfd); launch_denied(69); return 69; }

  int package_fd = openat2_one(rootfd, R3E_PACKAGE_ROOT + 1, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (package_fd < 0 || check_component(package_fd, root_mount, 0, NULL) != 0 || fchdir(package_fd) != 0) {
    if (package_fd >= 0) close(package_fd);
    close(rootfd);
    launch_denied(69);
    return 69;
  }

  struct stat manifest_stat;
  char manifest_open_digest[65];
  int manifest_fd = open_root_relative(rootfd, root_mount, R3E_MANIFEST_PATH, &manifest_stat, manifest_open_digest);
  if (manifest_fd < 0 || strcmp(manifest_open_digest, R3E_MANIFEST_SHA256) != 0) {
    if (manifest_fd >= 0) close(manifest_fd);
    close(package_fd);
    close(rootfd);
    launch_denied(69);
    return 69;
  }
  char *manifest_bytes = NULL;
  size_t manifest_length = 0;
  if (read_exact_file(manifest_fd, &manifest_stat, &manifest_bytes, &manifest_length) != 0) {
    close(manifest_fd); close(package_fd); close(rootfd); launch_denied(69); return 69;
  }
  package_entry entries[MAX_PACKAGE_ENTRIES];
  memset(entries, 0, sizeof(entries));
  size_t entry_count = 0;
  if (parse_manifest(manifest_bytes, entries, &entry_count) != 0 ||
      !is_manifest_path(R3E_NODE_PATH, entries, entry_count) || !is_manifest_path(R3E_CLI_PATH, entries, entry_count) ||
      !is_manifest_path(R3E_BOOTSTRAP_PATH, entries, entry_count) ||
      !is_manifest_path(R3E_HELPER_PATH, entries, entry_count) || !is_manifest_path(R3E_LOADER_PATH, entries, entry_count) ||
      verify_entries(rootfd, root_mount, entries, entry_count) != 0) {
    free(manifest_bytes); close(manifest_fd); close(package_fd); close(rootfd); launch_denied(70); return 70;
  }

  struct stat node_stat, cli_stat, bootstrap_stat, helper_stat, loader_stat, self_stat;
  char node_digest[65], cli_digest[65], bootstrap_digest[65], helper_digest[65], loader_digest[65], launcher_digest[65];
  int node_fd = open_root_relative(rootfd, root_mount, R3E_NODE_PATH, &node_stat, node_digest);
  int cli_fd = open_root_relative(rootfd, root_mount, R3E_CLI_PATH, &cli_stat, cli_digest);
  int bootstrap_fd = open_root_relative(rootfd, root_mount, R3E_BOOTSTRAP_PATH, &bootstrap_stat, bootstrap_digest);
  int helper_fd = open_root_relative(rootfd, root_mount, R3E_HELPER_PATH, &helper_stat, helper_digest);
  int loader_fd = open_root_relative(rootfd, root_mount, R3E_LOADER_PATH, &loader_stat, loader_digest);
  char self_path[PATH_MAX];
  ssize_t self_length = readlink("/proc/self/exe", self_path, sizeof(self_path) - 1);
  int self_fd = open("/proc/self/exe", O_RDONLY | O_CLOEXEC);
  if (self_length <= 0 || self_length >= (ssize_t)sizeof(self_path) || node_fd < 0 || cli_fd < 0 || bootstrap_fd < 0 || helper_fd < 0 || loader_fd < 0 || self_fd < 0) {
    free(manifest_bytes); close(manifest_fd); close(rootfd); launch_denied(70); return 70;
  }
  self_path[self_length] = '\0';
  struct stat pinned_launcher_stat;
  char pinned_launcher_digest[65];
  int pinned_launcher_fd = open_root_relative(rootfd, root_mount, R3E_LAUNCHER_PATH, &pinned_launcher_stat, pinned_launcher_digest);
  int launcher_hash_ok = self_fd >= 0 && fstat(self_fd, &self_stat) == 0 && sha256_open_file(self_fd, &self_stat, launcher_digest) == 0;
  if (pinned_launcher_fd < 0 || strcmp(self_path, R3E_LAUNCHER_PATH) != 0 || fstat(self_fd, &self_stat) != 0 ||
      self_stat.st_dev != pinned_launcher_stat.st_dev || self_stat.st_ino != pinned_launcher_stat.st_ino ||
      !launcher_hash_ok || strcmp(pinned_launcher_digest, launcher_digest) != 0 ||
      strcmp(node_digest, manifest_digest_for(entries, entry_count, R3E_NODE_PATH)) != 0 ||
      strcmp(cli_digest, manifest_digest_for(entries, entry_count, R3E_CLI_PATH)) != 0 ||
      strcmp(bootstrap_digest, manifest_digest_for(entries, entry_count, R3E_BOOTSTRAP_PATH)) != 0 ||
      strcmp(helper_digest, manifest_digest_for(entries, entry_count, R3E_HELPER_PATH)) != 0 ||
      strcmp(loader_digest, manifest_digest_for(entries, entry_count, R3E_LOADER_PATH)) != 0 ||
      verify_package_tree(package_fd, root_mount, entries, entry_count, launcher_digest) != 0) {
    if (pinned_launcher_fd >= 0) close(pinned_launcher_fd);
    free(manifest_bytes); close(manifest_fd); close(rootfd); launch_denied(70); return 70;
  }
  close(pinned_launcher_fd);

  char context[MAX_CONTEXT_BYTES];
  const char *invocation_id = getenv("INVOCATION_ID");
  int context_length = snprintf(context, sizeof(context),
    "R3E-ISSUER-LAUNCH-V2\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%u\n%u\n%zu\n",
    argv[1], invocation_id, R3E_LAUNCHER_PATH, launcher_digest, R3E_NODE_PATH, node_digest, R3E_CLI_PATH, cli_digest,
    R3E_BOOTSTRAP_PATH, bootstrap_digest, R3E_HELPER_PATH, helper_digest, R3E_LOADER_PATH, loader_digest, R3E_MANIFEST_PATH, R3E_MANIFEST_SHA256,
    R3E_PACKAGE_ROOT, (unsigned)R3E_ISSUER_UID, (unsigned)R3E_ISSUER_GID, entry_count);
  if (context_length <= 0 || context_length >= (int)sizeof(context)) {
    free(manifest_bytes); close(manifest_fd); close(package_fd); close(rootfd); launch_denied(71); return 71;
  }
  if (verify_entries(rootfd, root_mount, entries, entry_count) != 0) {
    free(manifest_bytes); close(manifest_fd); close(package_fd); close(rootfd); launch_denied(73); return 73;
  }
  if (verify_package_tree(package_fd, root_mount, entries, entry_count, launcher_digest) != 0) {
    free(manifest_bytes); close(manifest_fd); close(package_fd); close(rootfd); launch_denied(74); return 74;
  }

  int cli_target_fd = fcntl(cli_fd, F_DUPFD_CLOEXEC, 32);
  int node_target_fd = fcntl(node_fd, F_DUPFD_CLOEXEC, 32);
  int loader_target_fd = fcntl(loader_fd, F_DUPFD_CLOEXEC, 32);
  char launch_context_env[MAX_CONTEXT_BYTES + 32];
  int environment_length = snprintf(launch_context_env, sizeof(launch_context_env), "MAYDAN_R3E_CONTEXT=%s", context);
  if (environment_length <= 0 || environment_length >= (int)sizeof(launch_context_env) ||
      cli_target_fd < 0 || node_target_fd < 0 || loader_target_fd < 0 ||
      dup3(cli_target_fd, STDIN_FILENO, 0) < 0 || dup3(node_target_fd, 32, 0) < 0 ||
      dup3(loader_target_fd, 7, O_CLOEXEC) < 0) {
    free(manifest_bytes); close(manifest_fd); close(rootfd); launch_denied(75); return 75;
  }
  if (close_range(3, 6, 0) != 0 || close_range(8, 31, 0) != 0 || close_range(33, UINT_MAX, 0) != 0) {
    free(manifest_bytes); close(manifest_fd); close(package_fd); close(rootfd); launch_denied(76); return 76;
  }

  char *child_argv[] = { (char *)R3E_LOADER_PATH, "--inhibit-cache", "--glibc-hwcaps-mask", "",
    "--library-path", (char *)R3E_LIBRARY_PATH,
    "/proc/self/fd/32", "--import", (char *)R3E_BOOTSTRAP_PATH, "-", argv[1], NULL };
  char invocation_id_env[64];
  int invocation_env_length = snprintf(invocation_id_env, sizeof(invocation_id_env), "INVOCATION_ID=%s", invocation_id);
  if (invocation_env_length <= 0 || invocation_env_length >= (int)sizeof(invocation_id_env)) {
    free(manifest_bytes); close(manifest_fd); close(package_fd); close(rootfd); launch_denied(77); return 77;
  }
  char *child_env[] = { "NODE_ENV=production", launch_context_env, invocation_id_env, NULL };
  free(manifest_bytes);
  close(manifest_fd);
  close(package_fd);
  close(rootfd);
  execveat(7, "", child_argv, child_env, AT_EMPTY_PATH);
  launch_denied(72);
  return 72;
}
