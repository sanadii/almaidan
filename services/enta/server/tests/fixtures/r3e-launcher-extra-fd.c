#define _GNU_SOURCE
#include <fcntl.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc != 3) return 120;
  int descriptor = open("/dev/null", O_RDONLY);
  if (descriptor != 3) return 121;
  execl(argv[1], argv[1], argv[2], (char *)NULL);
  return 122;
}
