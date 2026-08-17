; SPDX-FileCopyrightText: 2026 Pagefault Games
;
; SPDX-License-Identifier: AGPL-3.0-only

; Early test installers used an unaccented product name and therefore left a
; second shortcut behind when the final installer identity was introduced.
; Remove only those obsolete shortcuts; the old application directory and all
; user profiles remain untouched so this migration cannot remove save data.
!macro customInstall
  Delete "$SMPROGRAMS\PokeRogue Keagan Edition.lnk"
  Delete "$DESKTOP\PokeRogue Keagan Edition.lnk"
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\PokeRogue Keagan Edition.lnk"
  Delete "$DESKTOP\PokeRogue Keagan Edition.lnk"
!macroend
