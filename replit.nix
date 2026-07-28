{pkgs}: {
  deps = [
    pkgs.libffi
    pkgs.gobject-introspection
    pkgs.freetype
    pkgs.fontconfig
    pkgs.harfbuzz
    pkgs.gdk-pixbuf
    pkgs.cairo
    pkgs.pango
  ];
}
