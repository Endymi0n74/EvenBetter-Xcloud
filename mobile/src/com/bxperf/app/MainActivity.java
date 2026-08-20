package com.bxperf.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.util.Enumeration;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

/**
 * Minimal WebView wrapper for the EvenBetterXcloud userscript.
 *
 * Loads https://www.xbox.com/play and injects the stable build
 * (better-xcloud.user.js) as early as possible on every xbox.com page.
 * The script is a plain userscript (@grant none) with no GM_* APIs.
 *
 * Injection document-start (19 août) : shouldInterceptRequest proxie le
 * document principal et inline le userscript dans un <script> juste après
 * <head> — AVANT tout module ESM du site. C'est ce qui bat le SDK preview,
 * dont la classe HTTP capture `fetch` au moment du `new` (le
 * evaluateJavascript d'onPageStarted arrivait trop tard → régions vides sur
 * play.xbox.com). Fallback evaluateJavascript si le proxy échoue (cache-hit,
 * réseau KO) ; idempotence garantie par le marqueur window.__EBX_INJECTED__
 * (le bundle n'a pas de garde interne).
 *
 * Robustesse (18 août) :
 *  - erreurs réseau / HTTP / SSL de la frame principale → page d'erreur
 *    lisible (plus d'écran blanc) avec bouton « Réessayer » ;
 *  - retry automatique 3× avec backoff 5 s / 15 s / 30 s (remis à zéro dès
 *    qu'une page xbox.com se charge avec succès) ;
 *  - les liens externes (hors xbox.com / login / account.microsoft.com)
 *    s'ouvrent dans le navigateur système au lieu de quitter la session ;
 *  - WebView.setWebContentsDebuggingEnabled(true) pour rejouer la
 *    validation (CDP via adb forward / chrome://inspect).
 *
 * NOTE : les WebViewClient/WebChromeClient sont des classes internes
 * STATIQUES nommées — PAS des classes anonymes. Le d8 de build-tools
 * 34.0.0 (R8 8.2.2-dev) plante en NullPointerException sur une classe
 * anonyme ayant une référence externe (this$0) ET une superclasse venant
 * du --lib (android.jar) : le dex sortait SANS la classe, l'app crasheait
 * au lancement (NoClassDefFoundError MainActivity$1).
 */
public class MainActivity extends Activity {

    // URL de départ : générée par build.sh (BuildConfig.START_URL) selon le
    // variant — stable = https://www.xbox.com/play, preview = https://play.xbox.com.
    private static final String START_URL = BuildConfig.START_URL;

    // Domaine(s) qui restent DANS le WebView (session de jeu + connexion Xbox)
    private static final String[] KEEP_IN_WEBVIEW = {
        "www.xbox.com",
        "login.live.com",
        "account.microsoft.com",
        "xbox.com",
    };

    // Badge de diagnostic — chargé depuis assets/diag.js (build de TEST
    // uniquement) : affiche en haut à gauche ~10 s l'état de l'injection et
    // de la session. ES5 pur, aucun échappement Java à gérer.
    private String diagJs;

    private static final int MAX_AUTO_RETRIES = 3;
    private static final long[] RETRY_DELAYS_MS = { 5_000L, 15_000L, 30_000L };

    private WebView webView;
    private String userscript;
    // Deux bundles embarqués : le build moderne (better-xcloud.user.js) et sa
    // transpilation ES2017 (better-xcloud.es2017.user.js) pour les VIEUX
    // Android System WebView (Chrome < 80 : pas de ?. / ?? — Freebox Pop /
    // Android TV 9). Un test de capacité JS au démarrage choisit le bundle :
    // le code moderne crasherait en SyntaxError sur la box.
    private String userscriptModern;
    private String userscriptLegacy;
    private boolean isTv;

    // Injection document-start : posé par shouldInterceptRequest quand le
    // document principal a reçu le userscript inline, lu/reset par
    // onPageStarted (volatile : le proxy tourne sur un thread d'arrière-plan).
    private volatile boolean documentInjected = false;
    // UA réel du WebView (suffixe EvenBetterXcloud inclus) : le proxy le
    // transmet, sinon le site sert un HTML « navigateur inconnu » (mobile-detect).
    private String webViewUserAgent;

    // Défauts « box » (Android TV / Freebox Pop) : la box a un WebView faible →
    // on pose une fois les réglages légers du script (Économe : cap 5 Mbps +
    // 720p + animations réduites + pas de fusée) pour que le stream rame pas.
    // Depuis le 20 août : + ui.controllerFriendly=true (navigation manette /
    // télécommande dans l'overlay — le défaut du bundle est deviceType!==
    // "unknown", or la WebView de la box est « unknown » → overlay affiché
    // mais non navigable) + ui.layout=tv (layout Smart TV).
    // Idempotence VERSIONNÉE : le marqueur _bxTvDefaults passe à 2 quand on
    // enrichit les défauts — une box qui avait déjà le marqueur 1 (anciens
    // défauts sans controllerFriendly) re-posait rien, piège vécu le 20 août.
    private static final String JS_TV_DEFAULTS =
        "(function(){try{var s=JSON.parse(localStorage.getItem(\"BetterXcloud\")||\"{}\");"
        + "if(s[\"_bxTvDefaults\"]!==2){s[\"stream.video.maxBitrate\"]=5120000;"
        + "s[\"stream.video.resolution\"]=\"720p\";s[\"ui.reduceAnimations\"]=true;"
        + "s[\"ui.layout\"]=\"tv\";"
        + "s[\"loadingScreen.rocket\"]=\"hide\";s[\"_bxTvDefaults\"]=2;"
        + "localStorage.setItem(\"BetterXcloud\",JSON.stringify(s));"
        + "console.log(\"EvenBetterXcloud TV: defauts box appliques\");}}" + "catch(e){}})();";

    // Fullscreen video support (the xCloud player uses the browser fullscreen API)
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private int originalSystemUiVisibility;

    // Robustesse : état du chargement
    private int loadRetryCount = 0;
    private boolean errorPageShowing = false;
    private AutoRetry pendingAutoRetry = null;

    // ---- Session import (20 août) : « Importer la session » sans ligne de
    // commande. Bridge exposé à la page (BXSessionImport) : startServer()
    // démarre un mini serveur HTTP LAN (receveur), send() POSTe le
    // localStorage vers un autre appareil (donneur — évite le mixed content
    // bloqué par MIXED_CONTENT_NEVER_ALLOW côté page). L'écriture dans la
    // WebView se fait par evaluateJavascript quand la page est sur l'origin
    // du donneur (pendingImport sinon : navigation puis écriture).
    private static final int SESSION_IMPORT_PORT = 8765;
    private volatile SessionImportServer importServer;
    private volatile PendingImport pendingImport;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Remote debugging for validation: lets us probe the page (BX markers,
        // overlay DOM) via CDP over `adb forward` (chrome://inspect).
        WebView.setWebContentsDebuggingEnabled(true);

        isTv = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_TYPE_MASK)
            == Configuration.UI_MODE_TYPE_TELEVISION;

        webView = new WebView(this);
        setContentView(webView);
        Log.d("EvenBetterXcloud", "uiMode: " + getResources().getConfiguration().uiMode
            + " isTv=" + isTv + " ua=" + webView.getSettings().getUserAgentString().substring(0, 40));

        userscriptModern = loadAsset("better-xcloud.user.js");
        userscriptLegacy = loadAsset("better-xcloud.es2017.user.js");
        userscript = userscriptModern; // choisi définitivement après le test de capacité
        diagJs = loadAsset("diag.js");
        Log.d("EvenBetterXcloud", "assets: userscript=" + (userscriptModern == null ? "NULL" : userscriptModern.length())
            + " es2017=" + (userscriptLegacy == null ? "NULL" : userscriptLegacy.length())
            + " diag=" + (diagJs == null ? "NULL" : diagJs.length()));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        // Perf WebView faible (box TV) : priorité de rendu haute (ignoré sur
        // les WebView modernes, aide les vieux), pas de fenêtres multiples.
        settings.setRenderPriority(WebSettings.RenderPriority.HIGH);
        settings.setSupportMultipleWindows(false);
        // UA suffix : version réelle de l'APK (versionName du manifest —
        // source unique VERSION à la racine, plus de hardcode 1.9.0)
        String bxVer = "unknown";
        try {
            bxVer = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception ignored) {}
        settings.setUserAgentString(settings.getUserAgentString() + " EvenBetterXcloud/" + bxVer);
        // UA réel du WebView (suffixe inclus) : transmis par le proxy document-start.
        webViewUserAgent = settings.getUserAgentString();

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new BxWebViewClient(this));
        webView.setWebChromeClient(new BxWebChromeClient(this));

        // Bridge « Importer la session » : le bundle (window.BXSessionImport)
        // démarre le serveur LAN (receveur) ou POSTe le localStorage (donneur).
        webView.addJavascriptInterface(new BxSessionImportBridge(this), "BXSessionImport");

        // Gaming: keep the screen on
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Choix du bundle (moderne vs es2017) par l'UA du WebView, SYNCHRONE :
        // l'optional chaining (?. ) est supporté à partir de Chrome 80. La box
        // (Android TV 9 — Freebox Pop) a un AOSP WebView ~Chrome 61 → bundle
        // es2017, sinon SyntaxError sur la 1re page. Un callback asynchrone
        // (ValueCallback) est ÉVITÉ : d8 34.0.0 plante sur les classes qui
        // implémentent une interface du --lib (android.jar).
        userscript = chooseBundle(webView.getSettings().getUserAgentString());
        Log.d("EvenBetterXcloud", "bundle choisi: " + (userscript == userscriptModern ? "modern" : "ES2017 legacy")
            + " (" + (userscript == null ? "NULL" : userscript.length()) + " o)");

        // Gaming: keep the screen on
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView.loadUrl(START_URL);
    }

    /**
     * UA du WebView → bundle. Chrome/≥80 (ou sans token Chrome) = moderne ;
     * Chrome/<80 = es2017 (?. absent avant 80).
     */
    private String chooseBundle(String userAgent) {
        if (userAgent != null) {
            java.util.regex.Matcher m =
                java.util.regex.Pattern.compile("Chrome/(\\d+)").matcher(userAgent);
            if (m.find()) {
                try {
                    int v = Integer.parseInt(m.group(1));
                    return v >= 80 ? userscriptModern : userscriptLegacy;
                } catch (NumberFormatException ignored) {}
            }
        }
        return userscriptLegacy; // WebView sans token Chrome (vieille AOSP) → es2017
    }

    // ---------- Robustesse : chargement / erreurs ----------

    /**
     * Affiche une page d'erreur lisible (au lieu d'un écran blanc) avec un
     * bouton « Réessayer » qui navigue vers START_URL.
     */
    void showErrorPage(String title, String detail, boolean autoRetryPending) {
        if (webView == null) {
            return;
        }
        Log.d("EvenBetterXcloud", "showErrorPage: " + title + " (retryCount=" + loadRetryCount + ")");
        errorPageShowing = true;
        String retryInfo = autoRetryPending
            ? "Nouvelle tentative automatique en cours… (réessai " + (loadRetryCount + 1) + "/" + MAX_AUTO_RETRIES + ")"
            : "Réessayez manuellement quand la connexion revient.";
        String html = buildErrorHtml(escapeHtml(title), escapeHtml(detail), escapeHtml(retryInfo));
        // base URL = null (PAS START_URL) : sinon le onPageFinished de la page
        // d'erreur porte une URL xbox.com → resetLoadState() annule le retry
        // en attente avant qu'il ne tire (reproduit 18 août). Le bouton
        // « Réessayer » est un lien absolu vers START_URL, il fonctionne sans base.
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    /**
     * Planifie le retry automatique (backoff 5/15/30 s, max 3). Remis à zéro
     * par resetLoadState() dès qu'une page réelle se charge.
     */
    void scheduleAutoRetry() {
        if (webView == null || loadRetryCount >= MAX_AUTO_RETRIES) {
            return;
        }
        final int attempt = loadRetryCount;
        loadRetryCount++;
        long delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
        Log.d("EvenBetterXcloud", "scheduleAutoRetry: attempt=" + attempt + " delay=" + delay);
        // Classe nommée (pas de lambda ni de classe anonyme : -source 8 +
        // bootclasspath android.jar n'a pas LambdaMetafactory, et d8 34.0.0
        // plante sur les classes anonymes avec superclasse du --lib).
        pendingAutoRetry = new AutoRetry(this);
        webView.postDelayed(pendingAutoRetry, delay);
    }

    /** Succès de chargement d'une vraie page : remet le compteur de retry à zéro
     *  et annule un éventuel retry encore en attente. */
    void resetLoadState() {
        Log.d("EvenBetterXcloud", "resetLoadState");
        if (webView != null && pendingAutoRetry != null) {
            webView.removeCallbacks(pendingAutoRetry);
            pendingAutoRetry = null;
        }
        loadRetryCount = 0;
        errorPageShowing = false;
    }

    /** Le chargement a échoué (network/HTTP/SSL) : remet aussi le compteur si besoin. */
    void noteFailure() {
        errorPageShowing = true;
    }

    /**
     * Une vraie page xbox.com commence à se charger (retry auto, bouton
     * Réessayer, navigation) : l'état d'erreur est terminé.
     * NOTE : onPageFinished est aussi appelé pour les navigations ÉCHOUÉES
     * (avec l'URL fautive) — d'où le garde !errorPageShowing dans onPageFinished.
     */
    void markRealPageStarted() {
        errorPageShowing = false;
    }

    /**
     * Fin de chargement : succès SEULEMENT si c'est une vraie page xbox.com
     * et qu'aucune page d'erreur n'est affichée (sinon le onPageFinished de
     * la navigation échouée annulerait le retry — reproduit 18 août).
     */
    void onPageFinished(String url) {
        if (url != null && isXboxDomain(url) && !errorPageShowing) {
            resetLoadState();
            // Import de session différé : la page est enfin sur l'origin du
            // donneur → écrire le localStorage puis recharger (la session
            // devient visible).
            if (pendingImport != null && url.startsWith(pendingImport.origin)) {
                PendingImport p = pendingImport;
                pendingImport = null;
                writeLocalStorage(p.body);
                webView.reload();
            }
        }
    }

    private String buildErrorHtml(String title, String detail, String retryInfo) {
        return "<!DOCTYPE html><html><head><meta charset=\"utf-8\">"
            + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            + "<style>"
            + "body{background:#0b0f14;color:#e8edf2;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;"
            + "display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}"
            + ".card{max-width:420px;padding:24px}.icon{font-size:56px}"
            + "h1{font-size:22px;margin:16px 0 8px}p{color:#9aa7b4;font-size:14px;line-height:1.5;margin:0}"
            + "a{display:inline-block;margin-top:22px;background:#107c10;color:#fff;text-decoration:none;"
            + "padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px}"
            + "small{display:block;margin-top:14px;color:#6b7681;font-size:12px}"
            + "</style></head><body><div class=\"card\">"
            + "<div class=\"icon\">🎮</div>"
            + "<h1>" + title + "</h1>"
            + "<p>" + detail + "</p>"
            + "<a href=\"" + START_URL + "\">Réessayer</a>"
            + "<small>" + retryInfo + "</small>"
            + "</div></body></html>";
    }

    private static String escapeHtml(String s) {
        if (s == null) {
            return "";
        }
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;");
    }

    private static boolean isXboxDomain(String url) {
        if (url == null) {
            return false;
        }
        for (String domain : KEEP_IN_WEBVIEW) {
            if (url.contains(domain)) {
                return true;
            }
        }
        return false;
    }

    // Double-BACK pour quitter l'appli depuis la home (fix 19 août) : le geste
    // BACK faisait goBack() dans l'historique SPA (7+ entrées), qui RENTRAIT
    // dans le stream après « Quitter » — « ça revient ». Hors /stream/, le
    // premier BACK affiche un toast, le second (2 s) ferme l'appli.
    private long lastBackPressed = 0;

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            String url = webView != null ? webView.getUrl() : null;
            boolean inStream = url != null && url.contains("/stream/");
            Log.d("EvenBetterXcloud", "BACK: url=" + url + " inStream=" + inStream
                + " canGoBack=" + (webView != null && webView.canGoBack()));
            if (!inStream) {
                // Home / produits / login : ne JAMAIS goBack() (l'historique SPA
                // re-rentre dans le stream). Double-BACK = quitter l'appli.
                long now = System.currentTimeMillis();
                if (now - lastBackPressed < 2000) {
                    finish();
                } else {
                    lastBackPressed = now;
                    Toast.makeText(this, "Appuyez encore pour quitter", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
            // En stream : BACK = quitter le stream (naviguer vers la home —
            // le client termine la session à la navigation, comme le bouton
            // Quitter de la game bar). PAS de goBack() : l'historique SPA
            // (7+ entrées) ne sort pas du stream proprement (« ko en stream »
            // constaté 19 août) et peut re-rentrer dans le stream.
            webView.loadUrl(START_URL);
            return true;
        }
        // Télécommande Android TV (Freebox Pop) : traduire le D-pad en
        // événements clavier pour la page web (le client xCloud écoute
        // ArrowUp/Down/Left/Right/Enter — le D-pad natif WebView ne fait que
        // le focus HTML). Retourne true pour ne pas déclencher le scroll natif
        // en plus (double mouvement).
        if (webView != null && isTv) {
            String key = null;
            if (keyCode == KeyEvent.KEYCODE_DPAD_UP) key = "ArrowUp";
            else if (keyCode == KeyEvent.KEYCODE_DPAD_DOWN) key = "ArrowDown";
            else if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT) key = "ArrowLeft";
            else if (keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) key = "ArrowRight";
            else if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER
                || keyCode == KeyEvent.KEYCODE_ENTER
                || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER) key = "Enter";
            if (key != null) {
                webView.evaluateJavascript(
                    "(function(){try{"
                    + "var ae=document.activeElement;"
                    + "document.dispatchEvent(new KeyboardEvent('keydown',{key:'" + key + "',code:'" + key + "',bubbles:true,cancelable:true}));"
                    + "if('" + key + "'==='Enter'&&ae&&(ae.tagName==='BUTTON'||ae.tagName==='A'||ae.tagName==='INPUT'||ae.tagName==='SELECT')){ae.click();}"
                    + "}catch(e){}})();",
                    null);
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) {
            webView.onPause();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
    }

    @Override
    protected void onDestroy() {
        stopImportServer();
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    // ---------- Session import (bridge + serveur LAN) ----------

    /**
     * Démarre (ou renvoie) le serveur LAN d'import. Appelé par la page via
     * window.BXSessionImport.startServer(). Retourne un JSON
     * {ok, url, code, ip, port} — le code + l'URL à saisir sur le donneur.
     */
    String startImportServer() {
        if (importServer != null && importServer.isAlive()) {
            return importServer.describe();
        }
        try {
            String code = String.format("%06d", (int) (Math.random() * 1000000));
            String ip = findLocalIp();
            importServer = new SessionImportServer(this, code, ip, SESSION_IMPORT_PORT);
            Thread t = new Thread(importServer, "bx-session-import");
            t.setDaemon(true);
            t.start();
            for (int i = 0; i < 100 && !importServer.isBound(); i++) {
                try {
                    Thread.sleep(50);
                } catch (InterruptedException ignored) {
                    break;
                }
            }
            if (!importServer.isBound()) {
                return "{\"ok\":false,\"error\":\"serveur non demarre\"}";
            }
            Log.d("EvenBetterXcloud", "SessionImport: serveur lancé " + importServer.describe());
            return importServer.describe();
        } catch (Throwable t) {
            Log.w("EvenBetterXcloud", "startImportServer: " + t);
            return "{\"ok\":false,\"error\":" + jsonQuote(String.valueOf(t.getMessage())) + "}";
        }
    }

    void stopImportServer() {
        if (importServer != null) {
            importServer.close();
            importServer = null;
        }
    }

    /**
     * Donneur : POSTe un payload JSON {origin, storage} vers l'URL du
     * receveur (l'autre appareil). Fait en JAVA (HttpURLConnection) car le
     * fetch() de la page vers http://LAN est bloqué par
     * MIXED_CONTENT_NEVER_ALLOW (mixed content https → http).
     */
    String sendImport(String url, String payload) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(8000);
            conn.setRequestProperty("Content-Type", "application/json");
            byte[] body = payload.getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(body.length);
            OutputStream os = conn.getOutputStream();
            os.write(body);
            os.flush();
            int status = conn.getResponseCode();
            InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String resp = in != null ? new String(readAll(in), StandardCharsets.UTF_8) : "";
            boolean ok = status >= 200 && status < 300;
            Log.d("EvenBetterXcloud", "SessionImport send: status=" + status + " ok=" + ok);
            return "{\"ok\":" + ok + ",\"status\":" + status + ",\"response\":" + jsonQuote(resp) + "}";
        } catch (Throwable t) {
            Log.w("EvenBetterXcloud", "sendImport: " + t);
            return "{\"ok\":false,\"error\":" + jsonQuote(String.valueOf(t.getMessage())) + "}";
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    /**
     * Receveur : un POST /import/<code> est arrivé avec le payload. Si la
     * page est déjà sur l'origin du donneur → écrire + recharger. Sinon
     * naviguer d'abord (l'écriture se fera dans onPageFinished).
     */
    void receiveImport(String body) {
        Log.d("EvenBetterXcloud", "SessionImport: payload reçu " + (body == null ? 0 : body.length()) + " o");
        if (body == null || body.isEmpty()) {
            return;
        }
        String origin = extractOrigin(body);
        if (origin == null || origin.isEmpty()) {
            Log.w("EvenBetterXcloud", "SessionImport: origin absente du payload");
            return;
        }
        String current = webView != null ? webView.getUrl() : null;
        if (current != null && current.startsWith(origin)) {
            writeLocalStorage(body);
            webView.reload();
        } else {
            pendingImport = new PendingImport(origin, body);
            Log.d("EvenBetterXcloud", "SessionImport: navigation vers " + origin);
            webView.loadUrl(origin);
        }
    }

    /** Écrit le payload {origin, storage} dans le localStorage de la page. */
    void writeLocalStorage(String body) {
        if (webView == null) {
            return;
        }
        String js = "(function(){try{var data=" + body
            + ";if(!data||!data.storage)return;for(var k in data.storage){try{localStorage.setItem(k,data.storage[k]);}catch(e){}}"
            + "console.log('EvenBetterXcloud: session importee ('+Object.keys(data.storage).length+' cles)');}"
            + "catch(e){console.error('EvenBetterXcloud import',e);}})();";
        webView.evaluateJavascript(js, null);
    }

    /** IP IPv4 non-loopback de l'appareil (réseau local, ex. 192.168.x.x). */
    private static String findLocalIp() {
        try {
            Enumeration<NetworkInterface> nets = NetworkInterface.getNetworkInterfaces();
            while (nets != null && nets.hasMoreElements()) {
                NetworkInterface ni = nets.nextElement();
                if (ni == null || !ni.isUp() || ni.isLoopback()) {
                    continue;
                }
                Enumeration<InetAddress> addrs = ni.getInetAddresses();
                while (addrs != null && addrs.hasMoreElements()) {
                    InetAddress a = addrs.nextElement();
                    if (a != null && !a.isLoopbackAddress() && a instanceof Inet4Address) {
                        return a.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return "127.0.0.1";
    }

    private static String jsonQuote(String s) {
        if (s == null) {
            return "null";
        }
        StringBuilder sb = new StringBuilder(s.length() + 8);
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '"' || ch == '\\') {
                sb.append('\\').append(ch);
            } else if (ch == '\n') {
                sb.append("\\n");
            } else if (ch == '\r') {
                sb.append("\\r");
            } else if (ch == '\t') {
                sb.append("\\t");
            } else if (ch < 0x20) {
                sb.append(String.format("\\u%04x", (int) ch));
            } else {
                sb.append(ch);
            }
        }
        return sb.append('"').toString();
    }

    private static String extractOrigin(String body) {
        try {
            Matcher m = Pattern.compile("\"origin\"\\s*:\\s*\"([^\"]+)\"").matcher(body);
            return m.find() ? m.group(1) : null;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Retry automatique du chargement (backoff 5/15/30 s, max 3).
     * Named static inner class (see class javadoc for why not anonymous).
     */
    private static class AutoRetry implements Runnable {
        private final MainActivity activity;

        AutoRetry(MainActivity activity) {
            this.activity = activity;
        }

        @Override
        public void run() {
            MainActivity a = activity;
            Log.d("EvenBetterXcloud", "AutoRetry.run: errorPageShowing=" + a.errorPageShowing
                + " isFinishing=" + a.isFinishing());
            if (!a.isFinishing() && a.webView != null && a.errorPageShowing) {
                a.webView.loadUrl(START_URL);
            }
        }
    }

    /**
     * Bridge exposé à la page (window.BXSessionImport). Trois méthodes
     * minimales — la surface JS est la plus réduite possible.
     * Named static inner class (see class javadoc for why not anonymous).
     */
    private static class BxSessionImportBridge {
        private final MainActivity activity;

        BxSessionImportBridge(MainActivity activity) {
            this.activity = activity;
        }

        @JavascriptInterface
        public String startServer() {
            return activity.startImportServer();
        }

        @JavascriptInterface
        public void stopServer() {
            activity.stopImportServer();
        }

        @JavascriptInterface
        public String send(String url, String payload) {
            return activity.sendImport(url, payload);
        }
    }

    /** Import différé : attendre que la page soit sur l'origin du donneur. */
    private static class PendingImport {
        final String origin;
        final String body;

        PendingImport(String origin, String body) {
            this.origin = origin;
            this.body = body;
        }
    }

    /**
     * Mini serveur HTTP LAN (receveur). Accepte POST /import/<code> avec un
     * payload JSON {origin, storage}, répond avec CORS (pour un éventuel
     * fetch direct) et soumet le payload à l'activité (thread UI).
     */
    private static class SessionImportServer implements Runnable {
        private final MainActivity activity;
        private final String code;
        private final String ip;
        private final int startPort;
        // Port réellement bindé : si 8765 est occupé (ex. l'autre APK sur le
        // même appareil a déjà son serveur), on essaie les ports suivants.
        private volatile int actualPort = 0;
        private volatile ServerSocket serverSocket;
        private volatile boolean bound = false;

        SessionImportServer(MainActivity activity, String code, String ip, int port) {
            this.activity = activity;
            this.code = code;
            this.ip = ip;
            this.startPort = port;
        }

        boolean isBound() {
            return bound;
        }

        boolean isAlive() {
            ServerSocket s = serverSocket;
            return s != null && !s.isClosed();
        }

        String describe() {
            int p = actualPort > 0 ? actualPort : startPort;
            String url = "http://" + ip + ":" + p + "/import/" + code;
            return "{\"ok\":true,\"url\":" + jsonQuote(url) + ",\"code\":" + jsonQuote(code)
                + ",\"ip\":" + jsonQuote(ip) + ",\"port\":" + p + "}";
        }

        void close() {
            try {
                ServerSocket s = serverSocket;
                if (s != null) {
                    s.close();
                }
            } catch (IOException ignored) {
            }
        }

        @Override
        public void run() {
            // null = toutes les interfaces (0.0.0.0) — joignable depuis le LAN.
            // Port occupé (ex. l'autre APK sur le même appareil) → essayer les
            // suivants jusqu'à +10 (une seule app reçoit à la fois en usage réel).
            IOException last = null;
            for (int attempt = 0; attempt < 10; attempt++) {
                int p = startPort + attempt;
                try {
                    serverSocket = new ServerSocket(p, 8, null);
                    actualPort = p;
                    bound = true;
                    Log.d("EvenBetterXcloud", "SessionImport: écoute sur :" + p);
                    while (isAlive()) {
                        final Socket socket = serverSocket.accept();
                        Thread t = new Thread(new ImportRequestHandler(activity, socket, code), "bx-import-req");
                        t.setDaemon(true);
                        t.start();
                    }
                    return;
                } catch (IOException e) {
                    last = e;
                    Log.w("EvenBetterXcloud", "SessionImport: port " + p + " indisponible, essai suivant");
                }
            }
            Log.w("EvenBetterXcloud", "SessionImport: aucun port libre (" + last + ")");
        }
    }

    /** Applique un payload d'import reçu sur le thread UI (éclatement
     *  thread : le serveur HTTP tourne sur un thread d'arrière-plan). */
    private static class ImportApply implements Runnable {
        private final MainActivity activity;
        private final String payload;

        ImportApply(MainActivity activity, String payload) {
            this.activity = activity;
            this.payload = payload;
        }

        @Override
        public void run() {
            activity.receiveImport(payload);
        }
    }

    /** Traite UNE requête HTTP (POST /import/<code>). */
    private static class ImportRequestHandler implements Runnable {
        private final MainActivity activity;
        private final Socket socket;
        private final String code;

        ImportRequestHandler(MainActivity activity, Socket socket, String code) {
            this.activity = activity;
            this.socket = socket;
            this.code = code;
        }

        @Override
        public void run() {
            BufferedReader in = null;
            OutputStream out = null;
            try {
                socket.setSoTimeout(15000);
                in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                String requestLine = in.readLine();
                if (requestLine == null) {
                    return;
                }
                String[] parts = requestLine.split(" ");
                String method = parts.length > 0 ? parts[0] : "";
                String path = parts.length > 1 ? parts[1] : "/";
                int contentLength = -1;
                String line;
                while ((line = in.readLine()) != null && !line.isEmpty()) {
                    if (line.regionMatches(true, 0, "content-length:", 0, 15)) {
                        try {
                            contentLength = Integer.parseInt(line.substring(15).trim());
                        } catch (NumberFormatException ignored) {
                        }
                    }
                }

                int status = 200;
                String reason = "OK";
                String responseBody = "";
                if ("OPTIONS".equalsIgnoreCase(method)) {
                    // préflight CORS (fetch direct éventuel) — réponse vide
                } else if ("POST".equalsIgnoreCase(method) && path.startsWith("/import/")) {
                    String pathCode = path.substring("/import/".length());
                    if (!code.equals(pathCode)) {
                        status = 403;
                        reason = "Forbidden";
                        responseBody = "{\"ok\":false,\"error\":\"code invalide\"}";
                    } else {
                        int len = contentLength > 0 ? contentLength : 65536;
                        char[] buf = new char[len];
                        int n = in.read(buf, 0, len);
                        String body = n > 0 ? new String(buf, 0, n) : "";
                        final String payload = body;
                        // Écriture dans la WebView : thread UI obligatoire.
                        // Classe nommée (pas d'anonyme : piège d8 documenté).
                        activity.runOnUiThread(new ImportApply(activity, payload));
                        responseBody = "{\"ok\":true}";
                    }
                } else {
                    status = 404;
                    reason = "Not Found";
                    responseBody = "{\"ok\":false,\"error\":\"not found\"}";
                }

                byte[] bytes = responseBody.getBytes(StandardCharsets.UTF_8);
                out = socket.getOutputStream();
                String head = "HTTP/1.1 " + status + " " + reason + "\r\n"
                    + "Content-Type: application/json\r\n"
                    + "Content-Length: " + bytes.length + "\r\n"
                    + "Access-Control-Allow-Origin: *\r\n"
                    + "Access-Control-Allow-Methods: POST, OPTIONS\r\n"
                    + "Access-Control-Allow-Headers: Content-Type\r\n"
                    + "Connection: close\r\n\r\n";
                out.write(head.getBytes(StandardCharsets.UTF_8));
                out.write(bytes);
                out.flush();
            } catch (IOException e) {
                Log.w("EvenBetterXcloud", "SessionImport req: " + e);
            } finally {
                try {
                    if (in != null) {
                        in.close();
                    }
                } catch (IOException ignored) {
                }
                try {
                    if (out != null) {
                        out.close();
                    }
                } catch (IOException ignored) {
                }
                try {
                    socket.close();
                } catch (IOException ignored) {
                }
            }
        }
    }

    /**
     * Named static inner class (see class javadoc for why not anonymous).
     */
    private static class BxWebViewClient extends WebViewClient {
        private final MainActivity activity;

        BxWebViewClient(MainActivity activity) {
            this.activity = activity;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
            boolean isXbox = url != null && isXboxDomain(url);
            if (isXbox) {
                activity.markRealPageStarted();
            }
            // Le document a déjà reçu le userscript inline (shouldInterceptRequest) ?
            // Alors on ne ré-injecte pas. Idempotence en plus par le marqueur
            // window.__EBX_INJECTED__ (le bundle n'a PAS de garde interne).
            boolean injectedEarly = activity.documentInjected;
            activity.documentInjected = false; // prochaine navigation : réintercepter
            // xbox.com only (matches the userscript's @match set); the
            // script no-ops internally on non-play pages.
            String userscript = activity.userscript;
            if (isXbox && userscript != null && !injectedEarly) {
                // Fallback (interception impossible : document servi depuis le
                // cache HTTP, proxy KO…) : injection tardive comme avant.
                // TV : poser les défauts « box » AVANT le script (le script lit
                // localStorage à l'init) — idempotent, une seule fois.
                if (activity.isTv) {
                    view.evaluateJavascript(
                        "(function(){try{if(!window.__EBX_INJECTED__){window.__EBX_INJECTED__=1;"
                        + JS_TV_DEFAULTS + "}}catch(e){}})();",
                        null);
                }
                view.evaluateJavascript(
                    "(function(){try{if(!window.__EBX_INJECTED__){window.__EBX_INJECTED__=1;"
                    + userscript + "}}catch(e){console.error('EvenBetterXcloud inject',e)}})();",
                    null);
            }
        }

        /**
         * Injection document-start (19 août) : intercepte la requête du
         * document principal (GET https sur les domaines xbox.com), proxie la
         * page et inline le userscript après <head> — AVANT tout module ESM du
         * site. Le SDK preview capture `fetch` au `new` de sa classe HTTP :
         * c'est le seul moyen de poser notre hook avant. En échec → null =
         * chargement normal (le fallback d'onPageStarted prend le relais).
         */
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            try {
                if (request == null || !request.isForMainFrame()) {
                    return super.shouldInterceptRequest(view, request);
                }
                // GET uniquement : les POST (soumission login.live.com) passent
                // tels quels — relayer le corps serait risqué pour l'auth.
                if (!"GET".equalsIgnoreCase(request.getMethod())) {
                    return super.shouldInterceptRequest(view, request);
                }
                String url = request.getUrl() != null ? request.getUrl().toString() : "";
                if (!isXboxDomain(url) || !url.startsWith("https://")) {
                    return super.shouldInterceptRequest(view, request);
                }
                String userscript = activity.userscript;
                if (userscript == null || activity.documentInjected) {
                    return super.shouldInterceptRequest(view, request);
                }
                WebResourceResponse resp = activity.proxyAndInject(url, userscript);
                if (resp != null) {
                    activity.documentInjected = true;
                    Log.d("EvenBetterXcloud", "document-start injecté sur " + url);
                }
                return resp != null ? resp : super.shouldInterceptRequest(view, request);
            } catch (Throwable t) {
                Log.w("EvenBetterXcloud", "shouldInterceptRequest repli: " + t);
                return super.shouldInterceptRequest(view, request);
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            activity.onPageFinished(url);
            // Badge de diagnostic : vraie page xbox.com chargée, pas une page
            // d'erreur. Lecture seule — ne touche pas au userscript.
            if (url != null && isXboxDomain(url) && !activity.errorPageShowing
                    && activity.diagJs != null) {
                Log.d("EvenBetterXcloud", "inject diag badge on " + url);
                view.evaluateJavascript(activity.diagJs, null);
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (request == null || !request.isForMainFrame()) {
                return; // sous-ressource : laisser la page décider
            }
            int code = error != null ? error.getErrorCode() : -1;
            String desc = error != null && error.getDescription() != null
                ? error.getDescription().toString() : "Erreur réseau";
            if (code == WebViewClient.ERROR_HOST_LOOKUP
                || code == WebViewClient.ERROR_CONNECT
                || code == WebViewClient.ERROR_TIMEOUT
                || code == WebViewClient.ERROR_UNKNOWN
                || code == -1) {
                activity.noteFailure();
                activity.showErrorPage(
                    "Connexion impossible",
                    "Impossible de joindre Xbox Cloud Gaming. Vérifiez votre connexion réseau.",
                    true);
                activity.scheduleAutoRetry();
            }
            // ERROR_CANCELED / ERROR_UNSUPPORTED_SCHEME etc. : navigation
            // interrompue par l'utilisateur ou gérée ailleurs → ne rien montrer.
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            super.onReceivedHttpError(view, request, errorResponse);
            if (request == null || !request.isForMainFrame() || errorResponse == null) {
                return;
            }
            int status = errorResponse.getStatusCode();
            activity.noteFailure();
            activity.showErrorPage(
                "Erreur serveur (" + status + ")",
                "Xbox Cloud Gaming a répondu avec une erreur HTTP " + status + ".",
                status >= 500);
            if (status >= 500) {
                activity.scheduleAutoRetry();
            }
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            // Ne jamais contourner un certificat invalide : page d'erreur
            // explicite (pas de retry automatique — un souci SSL ne se
            // résout pas tout seul).
            handler.cancel();
            activity.noteFailure();
            activity.showErrorPage(
                "Connexion non sécurisée",
                "Le certificat de sécurité n'a pas pu être vérifié. Réessayez plus tard.",
                false);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (request == null || !request.isForMainFrame()) {
                return false; // sous-frames : ne pas interférer
            }
            String url = request.getUrl() != null ? request.getUrl().toString() : "";
            if (isXboxDomain(url)) {
                return false; // reste dans le WebView (session de jeu + login)
            }
            if (url.startsWith("http://") || url.startsWith("https://")) {
                // Lien externe (support, téléchargement…) : navigateur système.
                try {
                    view.getContext().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (ActivityNotFoundException ignored) {
                    // pas de navigateur : on laisse le WebView tenter le chargement
                    return false;
                }
                return true;
            }
            return false;
        }
    }

    /**
     * Named static inner class (see class javadoc for why not anonymous).
     */
    private static class BxWebChromeClient extends WebChromeClient {
        private final MainActivity activity;

        BxWebChromeClient(MainActivity activity) {
            this.activity = activity;
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            MainActivity a = activity;
            if (a.customView != null) {
                callback.onCustomViewHidden();
                return;
            }
            a.customView = view;
            a.customViewCallback = callback;
            a.originalSystemUiVisibility = a.webView.getSystemUiVisibility();
            a.webView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
            a.addContentView(view, new android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT));
            a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }

        @Override
        public void onHideCustomView() {
            MainActivity a = activity;
            if (a.customView == null) {
                return;
            }
            a.webView.setSystemUiVisibility(a.originalSystemUiVisibility);
            a.webView.removeView(a.customView);
            a.customView = null;
            if (a.customViewCallback != null) {
                a.customViewCallback.onCustomViewHidden();
                a.customViewCallback = null;
            }
            a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
    }

    // ---------- Injection document-start (shouldInterceptRequest) ----------

    /**
     * Proxie la page demandée et renvoie le document avec le userscript
     * inline dans un <script> juste après <head>. Cookies du WebView
     * transmis et Set-Cookie rejoués (session intacte). La CSP du site est
     * retirée (elle bloque les scripts inline — on contrôle la réponse, pas
     * le contenu du site).
     *
     * Retourne null si le proxy échoue : le WebView charge normalement et
     * le fallback evaluateJavascript d'onPageStarted prend le relais.
     */
    WebResourceResponse proxyAndInject(String url, String userscript) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(15000);
            conn.setRequestMethod("GET");
            conn.setRequestProperty("User-Agent", webViewUserAgent != null ? webViewUserAgent : "");
            conn.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
            conn.setRequestProperty("Accept-Language", "fr-FR,fr;q=0.9,en;q=0.8");
            // Pas de gzip : le corps doit rester lisible tel quel (le WebView
            // ne re-décompresserait pas notre WebResourceResponse).
            conn.setRequestProperty("Accept-Encoding", "identity");
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null && !cookie.isEmpty()) {
                conn.setRequestProperty("Cookie", cookie);
            }

            int code = conn.getResponseCode();

            // Rejouer les Set-Cookie du proxy dans le jar du WebView : sans
            // ça la session posée par le document proxied serait perdue pour
            // les sous-ressources et les appels XHR du site.
            Map<String, List<String>> respHeaders = conn.getHeaderFields();
            boolean cookieChanged = false;
            for (Map.Entry<String, List<String>> e : respHeaders.entrySet()) {
                String name = e.getKey();
                if (name != null && name.equalsIgnoreCase("Set-Cookie")) {
                    List<String> values = e.getValue();
                    if (values != null) {
                        for (String v : values) {
                            CookieManager.getInstance().setCookie(url, v);
                            cookieChanged = true;
                        }
                    }
                }
            }
            if (cookieChanged) {
                CookieManager.getInstance().flush();
            }

            if (code != HttpURLConnection.HTTP_OK) {
                return null; // erreurs HTTP : le WebView gère (page d'erreur / retry)
            }

            InputStream raw = conn.getInputStream();
            String contentEncoding = conn.getHeaderField("Content-Encoding");
            InputStream in = raw;
            if (contentEncoding != null && contentEncoding.toLowerCase().contains("gzip")) {
                in = new GZIPInputStream(raw);
            }
            String charset = "UTF-8";
            String contentType = conn.getHeaderField("Content-Type");
            if (contentType != null) {
                Matcher m = Pattern.compile("charset=([^;\\s]+)").matcher(contentType);
                if (m.find()) {
                    charset = m.group(1);
                }
            }
            String html = new String(readAll(in), charset);
            try {
                in.close();
            } catch (IOException ignored) {
            }

            // IIFE obligatoire : le bundle a 6 déclarations top-level
            // let/const — inline brut dans la page, elles entreraient en
            // collision avec les globals du site (SyntaxError → script mort).
            // window.STATES est exposé EXPLICITEMENT par le bundle (patch 23),
            // donc le test latence fonctionne même encapsulé. Le marqueur
            // __EBX_INJECTED__ rend le tout idempotent (fallback possible).
            String tvDefaults = isTv ? JS_TV_DEFAULTS : "";
            String scriptBlock = "<script>if(!window.__EBX_INJECTED__){window.__EBX_INJECTED__=1;"
                + "(function(){try{" + tvDefaults + "\n" + userscript
                + "}catch(e){console.error('EvenBetterXcloud inject',e)}})();}</script>";
            String injected = injectInlineScript(html, scriptBlock);
            if (injected == null) {
                return null;
            }

            // Headers passés tels quels SAUF ceux qui contredisent le corps
            // réécrit ou bloquent l'inline : CSP (script-src sans
            // 'unsafe-inline' interdirait notre <script>), Content-Length /
            // Content-Encoding (corps modifié + déjà décompressé).
            Map<String, String> outHeaders = new HashMap<String, String>();
            for (Map.Entry<String, List<String>> e : respHeaders.entrySet()) {
                String name = e.getKey();
                if (name == null) {
                    continue;
                }
                if (name.equalsIgnoreCase("Content-Security-Policy")
                        || name.equalsIgnoreCase("Content-Security-Policy-Report-Only")
                        || name.equalsIgnoreCase("Content-Length")
                        || name.equalsIgnoreCase("Content-Encoding")
                        || name.equalsIgnoreCase("Transfer-Encoding")
                        || name.equalsIgnoreCase("Connection")
                        || name.equalsIgnoreCase("Set-Cookie")) {
                    continue;
                }
                List<String> values = e.getValue();
                if (values != null && !values.isEmpty()) {
                    outHeaders.put(name, values.get(0));
                }
            }
            return new WebResourceResponse("text/html", charset, 200, "OK", outHeaders,
                    new ByteArrayInputStream(injected.getBytes(charset)));
        } catch (Throwable t) {
            Log.w("EvenBetterXcloud", "proxyAndInject échec (" + url + "): " + t);
            return null;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    /** Insère scriptBlock juste après <head> (repli <html> puis <!doctype>). */
    private static String injectInlineScript(String html, String scriptBlock) {
        if (html == null) {
            return null;
        }
        Matcher m = Pattern.compile("(?i)<head[^>]*>").matcher(html);
        if (m.find()) {
            return html.substring(0, m.end()) + scriptBlock + html.substring(m.end());
        }
        m = Pattern.compile("(?i)<html[^>]*>").matcher(html);
        if (m.find()) {
            return html.substring(0, m.end()) + scriptBlock + html.substring(m.end());
        }
        m = Pattern.compile("(?i)<!doctype[^>]*>").matcher(html);
        if (m.find()) {
            return html.substring(0, m.end()) + scriptBlock + html.substring(m.end());
        }
        return scriptBlock + html;
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(64 * 1024);
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) {
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    private String loadAsset(String name) {
        try {
            InputStream is = getAssets().open(name);
            BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(512 * 1024);
            char[] buf = new char[8192];
            int n;
            while ((n = reader.read(buf)) != -1) {
                sb.append(buf, 0, n);
            }
            reader.close();
            return sb.toString();
        } catch (IOException e) {
            return null;
        }
    }
}
