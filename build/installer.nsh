; Customizacao do instalador NSIS gerado pelo electron-builder.
; electron-builder inclui este arquivo automaticamente (caminho padrao:
; build/installer.nsh) — nao precisa referenciar em package.json.
;
; Unica coisa customizada aqui: a pagina de boas-vindas do DESINSTALADOR
; vira uma escolha entre Reparar / Desinstalar mantendo dados / Desinstalar
; apagando tudo. O instalador (primeira instalacao / update) nao e tocado —
; continua 100% o assistente padrao do electron-builder.

!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "nsDialogs.nsh"

; plugin inetc (usado no "Reparar" pra baixar o instalador) — o
; electron-builder tambem acha sozinho build/x86-unicode/*.dll, mas
; declarar aqui garante que o diretorio ja esta disponivel antes do
; primeiro "inetc::get" mais abaixo neste mesmo arquivo.
!addplugindir /x86-unicode "${BUILD_RESOURCES_DIR}\x86-unicode"

; Sempre aponta pra ultima release publicada — nao muda a cada version bump.
!define REPARAR_BASE_URL "https://github.com/matxxs/Terminal-ia/releases/latest/download"

; electron-builder compila este script DUAS vezes — uma pro instalador, uma
; pro desinstalador (BUILD_UNINSTALLER so existe na segunda). Tudo daqui pra
; baixo e so codigo do desinstalador; sem esse guard o compilador acusa
; "uninstaller script code found but WriteUninstaller never used" na
; primeira passada (instalador nao chama WriteUninstaller).
!ifdef BUILD_UNINSTALLER

Var DialogoDesinstalar
Var RadioReparar
Var RadioManterDados
Var RadioApagarTudo
Var AcaoDesinstalar
Var ArquivoInstalador

!macro customUnWelcomePage
  UninstPage custom un.CriarPaginaEscolha un.SairPaginaEscolha
!macroend

Function un.CriarPaginaEscolha
  nsDialogs::Create 1018
  Pop $DialogoDesinstalar
  ${If} $DialogoDesinstalar == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0u 100% 24u "O que deseja fazer com o Terminal IA?"
  Pop $R0

  ${NSD_CreateRadioButton} 0 26u 100% 12u "Reparar (baixa e reinstala a versao atual, sem mexer nos seus dados)"
  Pop $RadioReparar
  ${NSD_SetState} $RadioReparar ${BST_CHECKED}

  ${NSD_CreateRadioButton} 0 48u 100% 12u "Desinstalar mantendo meus projetos, terminais e historico"
  Pop $RadioManterDados

  ${NSD_CreateRadioButton} 0 70u 100% 12u "Desinstalar e apagar tudo, inclusive meus dados"
  Pop $RadioApagarTudo

  nsDialogs::Show
FunctionEnd

Function un.SairPaginaEscolha
  ${NSD_GetState} $RadioApagarTudo $R0
  ${If} $R0 == ${BST_CHECKED}
    StrCpy $AcaoDesinstalar "apagar"
    Return
  ${EndIf}

  ${NSD_GetState} $RadioManterDados $R0
  ${If} $R0 == ${BST_CHECKED}
    StrCpy $AcaoDesinstalar "manter"
    Return
  ${EndIf}

  ; Reparar e o default (radio inicial marcado) e o unico caminho que nao
  ; deixa a pagina seguir pro fluxo normal de desinstalacao.
  StrCpy $AcaoDesinstalar "reparar"
  Call un.Reparar
  Pop $R0
  ${If} $R0 == "OK"
    MessageBox MB_OK "Terminal IA reparado com sucesso."
    Quit
  ${Else}
    MessageBox MB_ICONEXCLAMATION|MB_OK "Nao foi possivel reparar: $R0.$\r$\n$\r$\nVerifique sua conexao com a internet e tente de novo, ou escolha desinstalar."
    Abort
  ${EndIf}
FunctionEnd

; Baixa a latest.yml (sempre aponta pra ultima release), extrai o nome exato
; do instalador da linha "path:" e baixa+roda ele silencioso por cima da
; instalacao atual. Empilha "OK" ou uma mensagem de erro em $R0.
Function un.Reparar
  DetailPrint "Baixando informacoes da ultima versao..."
  inetc::get /USERAGENT "Terminal IA (reparo)" "${REPARAR_BASE_URL}/latest.yml" "$PLUGINSDIR\latest.yml" /END
  Pop $R0
  ${If} $R0 != "OK"
    Push "falha ao baixar latest.yml ($R0)"
    Return
  ${EndIf}

  ClearErrors
  FileOpen $R1 "$PLUGINSDIR\latest.yml" r
  ${If} ${Errors}
    Push "nao foi possivel ler latest.yml"
    Return
  ${EndIf}

  StrCpy $ArquivoInstalador ""
  linha:
    FileRead $R1 $R2
    IfErrors fimLeitura
    StrCpy $R3 $R2 6
    ${If} $R3 == "path: "
      StrCpy $ArquivoInstalador $R2 "" 6
      ; tira quebra de linha (CRLF ou LF) do final
      StrCpy $R4 $ArquivoInstalador 1 -1
      ${If} $R4 == "$\n"
      ${OrIf} $R4 == "$\r"
        StrCpy $ArquivoInstalador $ArquivoInstalador -1
      ${EndIf}
      StrCpy $R4 $ArquivoInstalador 1 -1
      ${If} $R4 == "$\r"
        StrCpy $ArquivoInstalador $ArquivoInstalador -1
      ${EndIf}
      Goto fimLeitura
    ${EndIf}
    Goto linha
  fimLeitura:
  FileClose $R1

  ${If} $ArquivoInstalador == ""
    Push "latest.yml nao trouxe o nome do instalador"
    Return
  ${EndIf}

  DetailPrint "Baixando $ArquivoInstalador..."
  inetc::get /USERAGENT "Terminal IA (reparo)" "${REPARAR_BASE_URL}/$ArquivoInstalador" "$PLUGINSDIR\reparo-instalador.exe" /END
  Pop $R0
  ${If} $R0 != "OK"
    Push "falha ao baixar $ArquivoInstalador ($R0)"
    Return
  ${EndIf}

  DetailPrint "Reinstalando..."
  ExecWait '"$PLUGINSDIR\reparo-instalador.exe" /S /D=$INSTDIR' $R0
  ${If} $R0 != 0
    Push "instalador retornou codigo $R0"
    Return
  ${EndIf}

  Push "OK"
FunctionEnd

; "Desinstalar apagando tudo" reusa o fluxo padrao de remocao de arquivos do
; NSIS (mantem atalhos/registro corretos) e so entra aqui, depois que a
; secao "un.install" ja terminou com sucesso, pra tambem apagar os dados.
; App e sempre per-user (perMachine:false), entao $APPDATA ja e o contexto
; certo sem precisar trocar SetShellVarContext.
Function un.onUninstSuccess
  ${If} $AcaoDesinstalar == "apagar"
    RMDir /r "$APPDATA\${APP_FILENAME}"
  ${EndIf}
FunctionEnd

!endif ; BUILD_UNINSTALLER
