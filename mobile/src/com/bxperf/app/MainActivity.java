package com.bxperf.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/**
 * Minimal WebView wrapper for the EvenBetterXcloud userscript.
 *
 * Loads https://www.xbox.com/play and injects the stable build
 * (better-xcloud.user.js) as early as possible on every xbox.com page.
 * The script is a plain userscript (@grant none) with no GM_* APIs, so a
 * raw evaluateJavascript() injection is equivalent to a document-start
 * userscript manager run.
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

    // Fullscreen video support (the xCloud player uses the browser fullscreen API)
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private int originalSystemUiVisibility;

    // Robustesse : état du chargement
    private int loadRetryCount = 0;
    private boolean errorPageShowing = false;
    private AutoRetry pendingAutoRetry = null;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Remote debugging for validation: lets us probe the page (BX markers,
        // overlay DOM) via CDP over `adb forward` (chrome://inspect).
        WebView.setWebContentsDebuggingEnabled(true);

        webView = new WebView(this);
        setContentView(webView);

        userscript = loadAsset("better-xcloud.user.js");
        diagJs = loadAsset("diag.js");
        Log.d("EvenBetterXcloud", "assets: userscript=" + (userscript == null ? "NULL" : userscript.length())
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
        settings.setUserAgentString(settings.getUserAgentString() + " EvenBetterXcloud/1.9.0");

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new BxWebViewClient(this));
        webView.setWebChromeClient(new BxWebChromeClient(this));

        // Gaming: keep the screen on
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView.loadUrl(START_URL);
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

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
            return true;
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
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
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
            // xbox.com only (matches the userscript's @match set); the
            // script no-ops internally on non-play pages.
            String userscript = activity.userscript;
            if (isXbox && userscript != null) {
                view.evaluateJavascript(
                    "(function(){try{" + userscript + "}catch(e){console.error('EvenBetterXcloud inject',e)}})();",
                    null);
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
