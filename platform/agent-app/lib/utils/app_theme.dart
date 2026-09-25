import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class AppTheme {
  // ── Ufriends BioSecure Brand Palette ──────────────────────────────
  static const Color bgBase       = Color(0xFFF3FCFD); // main bg
  static const Color bgSurface    = Color(0xFFFFFFFF); // cards, panels
  static const Color bgElevated   = Color(0xFFE8F4FB); // subtle elevated
  static const Color bgInput      = Color(0xFFEEF7FB); // input fill

  static const Color primary      = Color(0xFF004687); // deep navy blue
  static const Color primaryLight = Color(0xFF005FAF);
  static const Color primaryGlow  = Color(0x1A004687);

  static const Color secondary    = Color(0xFF1E90FF); // dodger blue
  static const Color secondaryLight = Color(0xFF4DAAFF);

  static const Color textPrimary   = Color(0xFF0D2137); // near black
  static const Color textSecondary = Color(0xFF3A5A7A); // muted navy
  static const Color textMuted     = Color(0xFF7BA3BF); // light muted
  static const Color textOnPrimary = Color(0xFFFFFFFF); // on primary btn

  static const Color statusSuccess = Color(0xFF00875A);
  static const Color statusWarning = Color(0xFFB25800);
  static const Color statusDanger  = Color(0xFFCC2929);
  static const Color statusInfo    = Color(0xFF1E90FF);

  static const Color borderSubtle  = Color(0xFFD0E8F5);
  static const Color borderDefault = Color(0xFFB0D4EB);
  static const Color borderBrand   = Color(0xFF80B5D8);
  static const Color divider       = Color(0xFFE4F0F7);

  static ThemeData get light {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      scaffoldBackgroundColor: bgBase,
      colorScheme: const ColorScheme.light(
        primary: primary,
        secondary: secondary,
        surface: bgSurface,
        error: statusDanger,
        onPrimary: textOnPrimary,
        onSecondary: textOnPrimary,
        onSurface: textPrimary,
      ),
      textTheme: GoogleFonts.interTextTheme(ThemeData.light().textTheme).copyWith(
        displayLarge: GoogleFonts.inter(
          fontSize: 26, fontWeight: FontWeight.w800, color: textPrimary),
        displayMedium: GoogleFonts.inter(
          fontSize: 20, fontWeight: FontWeight.w700, color: textPrimary),
        titleLarge: GoogleFonts.inter(
          fontSize: 16, fontWeight: FontWeight.w700, color: textPrimary),
        titleMedium: GoogleFonts.inter(
          fontSize: 14, fontWeight: FontWeight.w600, color: textPrimary),
        bodyLarge: GoogleFonts.inter(
          fontSize: 14, fontWeight: FontWeight.w400, color: textSecondary),
        bodyMedium: GoogleFonts.inter(
          fontSize: 13, fontWeight: FontWeight.w400, color: textSecondary),
        bodySmall: GoogleFonts.inter(
          fontSize: 11.5, fontWeight: FontWeight.w400, color: textMuted),
        labelSmall: GoogleFonts.inter(
          fontSize: 10, fontWeight: FontWeight.w600, color: textMuted,
          letterSpacing: 0.08),
      ),
      cardTheme: CardThemeData(
        color: bgSurface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: const BorderSide(color: borderSubtle, width: 1),
        ),
        margin: EdgeInsets.zero,
        shadowColor: Colors.transparent,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: bgInput,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: borderDefault),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: borderDefault),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: primary, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: statusDanger),
        ),
        labelStyle: GoogleFonts.inter(
          fontSize: 12, fontWeight: FontWeight.w600, color: textSecondary),
        hintStyle: GoogleFonts.inter(fontSize: 13.5, color: textMuted),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primary,
          foregroundColor: textOnPrimary,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          textStyle: GoogleFonts.inter(fontSize: 13.5, fontWeight: FontWeight.w700),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: primary,
          side: const BorderSide(color: borderBrand),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          textStyle: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.w600),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: secondary,
          textStyle: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.w600),
        ),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: bgSurface,
        elevation: 0,
        scrolledUnderElevation: 1,
        shadowColor: borderSubtle,
        centerTitle: false,
        titleTextStyle: GoogleFonts.inter(
          fontSize: 16, fontWeight: FontWeight.w700, color: primary),
        iconTheme: const IconThemeData(color: textSecondary),
        surfaceTintColor: Colors.transparent,
      ),
      dividerTheme: const DividerThemeData(
        color: divider,
        thickness: 1,
        space: 0,
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: primary,
        contentTextStyle: GoogleFonts.inter(color: Colors.white, fontSize: 13),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: bgSurface,
        selectedItemColor: primary,
        unselectedItemColor: textMuted,
        selectedLabelStyle: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.w700),
        unselectedLabelStyle: GoogleFonts.inter(fontSize: 11),
        elevation: 8,
        type: BottomNavigationBarType.fixed,
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: primary,
        foregroundColor: Colors.white,
        elevation: 4,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: bgElevated,
        labelStyle: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.w600),
        side: const BorderSide(color: borderDefault),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        padding: EdgeInsets.zero,
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: secondary,
        linearTrackColor: borderSubtle,
      ),
    );
  }
}
