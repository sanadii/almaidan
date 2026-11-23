#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/openat2.h>
#include <linux/stat.h>
#include <linux/magic.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/statfs.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/xattr.h>
#include <unistd.h>

#ifndef EXT4_SUPER_MAGIC
#define EXT4_SUPER_MAGIC 0xEF53
#endif

#define PINNED_OPERATOR_UID 0
#ifndef PINNED_ISSUER_UID
#define PINNED_ISSUER_UID 0
#endif
#define MAX_TARGETS 256
#define MAX_PATH_BYTES 4096
#define MAX_FILE_BYTES (128ULL * 1024ULL * 1024ULL)
#define RESOLUTION_FLAGS (RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_XDEV)

typedef struct {
  uint32_t state[8];
  uint64_t bit_length;
  uint8_t block[64];
  size_t block_length;
} sha256_context;

static const uint32_t SHA256_ROUND[64] = {
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
};

static uint32_t rotate_right(uint32_t value, unsigned count) {
  return (value >> count) | (value << (32U - count));
}

static void sha256_transform(sha256_context *context, const uint8_t block[64]) {
  uint32_t words[64];
  for (size_t i = 0; i < 16; i++) {
    size_t offset = i * 4;
    words[i] = ((uint32_t)block[offset] << 24) | ((uint32_t)block[offset + 1] << 16) |
      ((uint32_t)block[offset + 2] << 8) | (uint32_t)block[offset + 3];
  }
  for (size_t i = 16; i < 64; i++) {
    uint32_t x = words[i - 15];
    uint32_t y = words[i - 2];
    uint32_t sigma0 = rotate_right(x, 7) ^ rotate_right(x, 18) ^ (x >> 3);
    uint32_t sigma1 = rotate_right(y, 17) ^ rotate_right(y, 19) ^ (y >> 10);
    words[i] = words[i - 16] + sigma0 + words[i - 7] + sigma1;
  }

  uint32_t a = context->state[0], b = context->state[1], c = context->state[2], d = context->state[3];
  uint32_t e = context->state[4], f = context->state[5], g = context->state[6], h = context->state[7];
  for (size_t i = 0; i < 64; i++) {
    uint32_t sum1 = rotate_right(e, 6) ^ rotate_right(e, 11) ^ rotate_right(e, 25);
    uint32_t choose = (e & f) ^ (~e & g);
    uint32_t temp1 = h + sum1 + choose + SHA256_ROUND[i] + words[i];
    uint32_t sum0 = rotate_right(a, 2) ^ rotate_right(a, 13) ^ rotate_right(a, 22);
    uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
    uint32_t temp2 = sum0 + majority;
    h = g; g = f; f = e; e = d + temp1;
    d = c; c = b; b = a; a = temp1 + temp2;
  }
  context->state[0] += a; context->state[1] += b; context->state[2] += c; context->state[3] += d;
  context->state[4] += e; context->state[5] += f; context->state[6] += g; context->state[7] += h;
}

static void sha256_update(sha256_context *context, const uint8_t *bytes, size_t length) {
  for (size_t i = 0; i < length; i++) {
    context->block[context->block_length++] = bytes[i];
    if (context->block_length == sizeof(context->block)) {
      sha256_transform(context, context->block);
      context->bit_length += 512;
      context->block_length = 0;
    }
  }
}

static void sha256_finish(sha256_context *context, uint8_t digest[32]) {
  size_t index = context->block_length;
  context->block[index++] = 0x80;
  if (index > 56) {
    while (index < sizeof(context->block)) context->block[index++] = 0;
    sha256_transform(context, context->block);
    memset(context->block, 0, sizeof(context->block));
    index = 0;
  }
  while (index < 56) context->block[index++] = 0;
  context->bit_length += (uint64_t)context->block_length * 8;
  for (size_t i = 0; i < 8; i++) context->block[63 - i] = (uint8_t)(context->bit_length >> (i * 8));
  sha256_transform(context, context->block);
  for (size_t i = 0; i < 8; i++) {
    digest[i * 4] = (uint8_t)(context->state[i] >> 24);
    digest[i * 4 + 1] = (uint8_t)(context->state[i] >> 16);
    digest[i * 4 + 2] = (uint8_t)(context->state[i] >> 8);
    digest[i * 4 + 3] = (uint8_t)context->state[i];
  }
}

static int sha256_open_file(int fd, const struct stat *opened, char output[65]) {
  sha256_context context = { .state = {
    0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19
  } };
  uint8_t buffer[64 * 1024];
  off_t offset = 0;
  while (offset < opened->st_size) {
    off_t remaining = opened->st_size - offset;
    size_t request = remaining > (off_t)sizeof(buffer) ? sizeof(buffer) : (size_t)remaining;
    ssize_t count = pread(fd, buffer, request, offset);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return -1;
    sha256_update(&context, buffer, (size_t)count);
    offset += count;
  }
  uint8_t extra;
  ssize_t extra_count;
  do { extra_count = pread(fd, &extra, 1, offset); } while (extra_count < 0 && errno == EINTR);
  if (extra_count != 0) return -1;
  struct stat after;
  if (fstat(fd, &after) != 0 || after.st_dev != opened->st_dev || after.st_ino != opened->st_ino ||
      after.st_size != opened->st_size || after.st_mtim.tv_sec != opened->st_mtim.tv_sec ||
      after.st_mtim.tv_nsec != opened->st_mtim.tv_nsec || after.st_ctim.tv_sec != opened->st_ctim.tv_sec ||
      after.st_ctim.tv_nsec != opened->st_ctim.tv_nsec) return -1;
  uint8_t digest[32];
  sha256_finish(&context, digest);
  static const char hex[] = "0123456789abcdef";
  for (size_t i = 0; i < sizeof(digest); i++) {
    output[i * 2] = hex[digest[i] >> 4];
    output[i * 2 + 1] = hex[digest[i] & 0x0f];
  }
  output[64] = '\0';
  return 0;
}

static int openat2_one(int dirfd, const char *name, uint64_t flags) {
  struct open_how how = {
    .flags = flags,
    .resolve = RESOLUTION_FLAGS
  };
  return (int)syscall(SYS_openat2, dirfd, name, &how, sizeof(how));
}

static int deny_extended_acl(int fd) {
  char byte;
  errno = 0;
  ssize_t access_len = fgetxattr(fd, "system.posix_acl_access", &byte, sizeof(byte));
  if (access_len >= 0 || (errno != ENODATA && errno != ENOTSUP && errno != EOPNOTSUPP)) return -1;
  errno = 0;
  ssize_t default_len = fgetxattr(fd, "system.posix_acl_default", &byte, sizeof(byte));
  if (default_len >= 0 || (errno != ENODATA && errno != ENOTSUP && errno != EOPNOTSUPP)) return -1;
  return 0;
}

static int no_effective_capabilities(void) {
  FILE *status = fopen("/proc/self/status", "r");
  if (!status) return -1;
  char *line = NULL;
  size_t capacity = 0;
  unsigned found = 0;
  int ok = 1;
  while (getline(&line, &capacity, status) >= 0) {
    const char *labels[] = { "CapEff:", "CapPrm:", "CapInh:", "CapAmb:" };
    for (size_t i = 0; i < sizeof(labels) / sizeof(labels[0]); i++) {
      size_t n = strlen(labels[i]);
      if (strncmp(line, labels[i], n) == 0) {
        char *end = NULL;
        unsigned long long bits = strtoull(line + n, &end, 16);
        if (end == line + n || bits != 0) ok = 0;
        found++;
      }
    }
  }
  free(line);
  fclose(status);
  return ok && found == 4 ? 0 : -1;
}

static int statx_mount_id(int fd, uint64_t *mount_id) {
  struct statx stx;
  memset(&stx, 0, sizeof(stx));
  if (statx(fd, "", AT_EMPTY_PATH | AT_STATX_SYNC_AS_STAT, STATX_TYPE | STATX_INO | STATX_SIZE | STATX_MNT_ID, &stx) != 0)
    return -1;
  if ((stx.stx_mask & STATX_MNT_ID) == 0) return -1;
  *mount_id = stx.stx_mnt_id;
  return 0;
}

static int check_component(int fd, uint64_t root_mount, int final_component, struct stat *result) {
  struct stat st;
  struct statfs fs;
  uint64_t mount_id = 0;
  if (fstat(fd, &st) != 0 || fstatfs(fd, &fs) != 0 || statx_mount_id(fd, &mount_id) != 0) return -1;
  if ((uint64_t)fs.f_type != (uint64_t)EXT4_SUPER_MAGIC || mount_id != root_mount) return -1;
  if (st.st_uid != PINNED_OPERATOR_UID || (st.st_mode & 0022) != 0) return -1;
  if (deny_extended_acl(fd) != 0) return -1;
  errno = 0;
  if (faccessat(fd, "", W_OK, AT_EMPTY_PATH | AT_EACCESS) == 0) return -1;
  if (errno != EACCES && errno != EPERM && errno != EROFS) return -1;
  if (final_component) {
    if (!S_ISREG(st.st_mode) || st.st_nlink != 1 || st.st_size < 0 || (uint64_t)st.st_size > MAX_FILE_BYTES) return -1;
  } else if (!S_ISDIR(st.st_mode)) {
    return -1;
  }
  if (result) *result = st;
  return 0;
}

static int inspect_path(int rootfd, uint64_t root_mount, const char *absolute, struct stat *final_stat, char digest[65]) {
  if (!absolute || absolute[0] != '/' || strlen(absolute) > MAX_PATH_BYTES || strstr(absolute, "//")) return -1;
  char copy[MAX_PATH_BYTES + 1];
  memcpy(copy, absolute, strlen(absolute) + 1);
  int current = dup(rootfd);
  if (current < 0) return -1;
  char *cursor = copy + 1;
  char *segment = cursor;
  int result = -1;
  while (*cursor) {
    if (*cursor == '/') {
      *cursor = '\0';
      if (segment[0] == '\0' || strcmp(segment, ".") == 0 || strcmp(segment, "..") == 0) goto done;
      int next = openat2_one(current, segment, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
      if (next < 0 || check_component(next, root_mount, 0, NULL) != 0) {
        if (next >= 0) close(next);
        goto done;
      }
      close(current);
      current = next;
      segment = cursor + 1;
    }
    cursor++;
  }
  if (segment[0] == '\0' || strcmp(segment, ".") == 0 || strcmp(segment, "..") == 0) goto done;
  struct stat st;
  int finalfd = openat2_one(current, segment, O_RDONLY | O_CLOEXEC);
  if (finalfd < 0) goto done;
  if (check_component(finalfd, root_mount, 1, &st) != 0 || sha256_open_file(finalfd, &st, digest) != 0) {
    close(finalfd);
    goto done;
  }
  if (final_stat) *final_stat = st;
  close(finalfd);
  result = 0;
done:
  close(current);
  return result;
}

int main(int argc, char **argv) {
  if (argc < 2 || argc - 1 > MAX_TARGETS || PINNED_ISSUER_UID == 0) return 64;
  if (getuid() != geteuid() || (unsigned long)geteuid() != (unsigned long)PINNED_ISSUER_UID ||
      geteuid() == PINNED_OPERATOR_UID || no_effective_capabilities() != 0) return 65;

  int rootfd = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (rootfd < 0) return 66;
  struct statfs rootfs;
  uint64_t root_mount = 0;
  if (fstatfs(rootfd, &rootfs) != 0 || (uint64_t)rootfs.f_type != (uint64_t)EXT4_SUPER_MAGIC ||
      statx_mount_id(rootfd, &root_mount) != 0) {
    close(rootfd);
    return 67;
  }

  struct stat rootstat;
  if (fstat(rootfd, &rootstat) != 0 || rootstat.st_uid != PINNED_OPERATOR_UID ||
      (rootstat.st_mode & 0022) != 0 || deny_extended_acl(rootfd) != 0) {
    close(rootfd);
    return 68;
  }

  printf("R3E-CUSTODY-V1\t%lu\t%u\n", (unsigned long)root_mount, (unsigned)argc - 1);
  if (fflush(stdout) != 0) {
    close(rootfd);
    return 70;
  }
  for (int i = 1; i < argc; i++) {
    struct stat st;
    char digest[65];
    if (inspect_path(rootfd, root_mount, argv[i], &st, digest) != 0) {
      close(rootfd);
      return 69;
    }
    printf("%llu\t%llu\t%lld\t%u\t%s\n",
      (unsigned long long)st.st_dev,
      (unsigned long long)st.st_ino,
      (long long)st.st_size,
      (unsigned)(st.st_mode & 07777),
      digest);
  }
  close(rootfd);
  return ferror(stdout) ? 70 : 0;
}
