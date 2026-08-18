package com.bxperf.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/**
 * Minimal WebView wrapper for the Better xCloud Perf userscript.
 *
 * Loads https://www.xbox.com/play and injects the stable build
 * (better-xcloud.user.js) as early as possible on every xbox.com page.
 * The script is a plain userscript (@grant none) with no GM_* APIs, so a
 * raw evaluateJavascript() injection is equivalent to a document-start
 * userscript manager run.
 *
 * NOTE (18 août) : les WebViewClient/WebChromeClient sont des classes
 * internes STATIQUES nommées — PAS des classes anonymes. Le d8 de
 * build-tools 34.0.0 (R8 8.2.2-dev) plante en NullPointerException sur une
 * classe anonyme ayant une référence externe (this$0) ET une superclasse
 * venant du --lib (android.jar) : le dex sortait SANS la classe, l'app
 * crasheait au lancement (NoClassDefFoundError MainActivity$1).
 */
public class MainActivity extends Activity {

    private static final String START_URL = "https://www.xbox.com/play";

    private WebView webView;
    private String userscript;

    // Fullscreen video support (the xCloud player uses the browser fullscreen API)
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private int originalSystemUiVisibility;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        userscript = loadAsset("better-xcloud.user.js");

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUserAgentString(settings.getUserAgentString() + " BXPerf/1.8.0");

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new BxWebViewClient(this));
        webView.setWebChromeClient(new BxWebChromeClient(this));

        // Gaming: keep the screen on
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView.loadUrl(START_URL);
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
            // xbox.com only (matches the userscript's @match set); the
            // script no-ops internally on non-play pages.
            String userscript = activity.userscript;
            if (userscript != null && url != null && url.contains("xbox.com")) {
                view.evaluateJavascript(
                    "(function(){try{" + userscript + "}catch(e){console.error('BXPerf inject',e)}})();",
                    null);
            }
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
