// Source vectors for the separately qualified PostgreSQL native test harness.
// Values are IEEE-754 binary64 bits, written in network-order hexadecimal.
#include <cstdint>

struct BinaryVector { const char *operation; std::uint64_t left; std::uint64_t right; std::uint64_t expected; };
constexpr BinaryVector binary_vectors[] = {
  {"ADD", 0x3ff0000000000000ULL, 0x4000000000000000ULL, 0x4008000000000000ULL},
  {"SUB", 0x3ff0000000000000ULL, 0x4000000000000000ULL, 0xbff0000000000000ULL},
  {"MUL", 0xbff0000000000000ULL, 0x4000000000000000ULL, 0xc000000000000000ULL},
  {"DIV", 0x3ff0000000000000ULL, 0x8000000000000000ULL, 0xfff0000000000000ULL},
  {"REM", 0xc010000000000000ULL, 0x4000000000000000ULL, 0x8000000000000000ULL},
  {"MIN", 0x0000000000000000ULL, 0x8000000000000000ULL, 0x8000000000000000ULL},
  {"MAX", 0x0000000000000000ULL, 0x8000000000000000ULL, 0x0000000000000000ULL},
};
struct UnaryVector { const char *operation; std::uint64_t input; std::uint64_t expected; };
constexpr UnaryVector unary_vectors[] = {
  {"FLOOR", 0xbff8000000000000ULL, 0xc000000000000000ULL},
  {"CEIL", 0xbfe0000000000000ULL, 0x8000000000000000ULL},
  {"TRUNC", 0xbfe0000000000000ULL, 0x8000000000000000ULL},
  {"ABS", 0x8000000000000000ULL, 0x0000000000000000ULL},
  {"SIGN", 0x8000000000000000ULL, 0x8000000000000000ULL},
};

// Raw UTF-16BE code-unit domains for the qualified native differential
// harness. A high or low surrogate here is intentionally not replaced.
struct UnitsVector { const unsigned char *bytes; unsigned length; };
constexpr unsigned char nul_and_unpaired[] = {0x00,0x00,0xd8,0x00,0xdc,0x00,0xdc,0x00};
constexpr unsigned char astral_pair[] = {0xd8,0x3d,0xde,0x00};
constexpr unsigned char combining_acute[] = {0x00,0x65,0x03,0x01};
constexpr unsigned char composed_acute[] = {0x00,0xe9};
constexpr UnitsVector utf16_vectors[] = {
 {nul_and_unpaired,sizeof(nul_and_unpaired)}, {astral_pair,sizeof(astral_pair)},
 {combining_acute,sizeof(combining_acute)}, {composed_acute,sizeof(composed_acute)}
};
