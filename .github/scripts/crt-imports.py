import sys

import pefile

DYNAMIC_CRT = ("MSVCP", "VCRUNTIME", "VCCORLIB", "CONCRT")


def imported_dlls(path):
    pe = pefile.PE(path, fast_load=True)
    pe.parse_data_directories(directories=[
        pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_IMPORT"],
        pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT"],
    ])
    entries = getattr(pe, "DIRECTORY_ENTRY_IMPORT", []) + getattr(pe, "DIRECTORY_ENTRY_DELAY_IMPORT", [])
    return sorted({entry.dll.decode() for entry in entries}, key=str.lower)


def main(paths):
    failed = False
    for path in paths:
        dlls = imported_dlls(path)
        redist = [dll for dll in dlls if dll.upper().startswith(DYNAMIC_CRT)]
        print(path)
        for dll in dlls:
            print("  " + dll)
        if redist:
            print("  needs the Visual C++ Redistributable: " + ", ".join(redist))
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
