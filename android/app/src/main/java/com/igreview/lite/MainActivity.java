package com.igreview.lite;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Dos WebViews superpuestas:
 *  - appView: la interfaz (la misma web de /docs, empaquetada en el APK).
 *  - igView:  un navegador con la página real de Instagram (con tu sesión), que la
 *             interfaz coloca encima de la tarjeta del perfil mediante window.IGNative.
 */
public class MainActivity extends Activity {

    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String APP_URL = "https://" + APP_HOST + "/assets/index.html";
    private static final int FILE_REQUEST = 1001;

    // Lee el botón de la cabecera del perfil: "Siguiendo"/"Following" o "Seguir"/"Follow".
    private static final String FOLLOW_STATE_JS =
            "(function(){try{var h=document.querySelector('header');if(!h)return 'unknown';"
            + "var t=Array.prototype.map.call(h.querySelectorAll('button,[role=button]'),function(b){return (b.innerText||'').trim().toLowerCase();});"
            + "if(t.some(function(x){return /^(siguiendo|following|solicitado|requested)/.test(x);}))return 'following';"
            + "if(t.some(function(x){return /^(seguir|follow)/.test(x);}))return 'not_following';"
            + "return 'unknown';}catch(e){return 'unknown';}})()";

    private WebView appView;
    private WebView igView;
    private String igUser = null;
    private boolean clearIgHistory = false;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0B0B0C);

        appView = new WebView(this);
        root.addView(appView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        igView = new WebView(this);
        igView.setVisibility(View.GONE);
        root.addView(igView, new FrameLayout.LayoutParams(1, 1));

        setContentView(root);
        setupAppView();
        setupInstagramView();
        appView.loadUrl(APP_URL);
    }

    private void setupAppView() {
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebSettings s = appView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setTextZoom(100);

        appView.addJavascriptInterface(new Bridge(), "IGNative");

        appView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (APP_HOST.equals(url.getHost())) return false;
                openExternal(url);
                return true;
            }
        });

        appView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(intent, "Elegir archivo"), FILE_REQUEST);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
    }

    private void setupInstagramView() {
        WebSettings s = igView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        // Sin la marca "; wv" Instagram trata la vista como Chrome normal
        s.setUserAgentString(s.getUserAgentString().replace("; wv", ""));

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(igView, true);

        igView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String scheme = url.getScheme();
                String host = url.getHost() == null ? "" : url.getHost();
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    if (host.endsWith("instagram.com") || host.endsWith("facebook.com")) return false;
                    openExternal(url);
                }
                // intent://, instagram:// … (intentos de abrir la app oficial): se ignoran
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // Al cambiar de perfil, "atrás" no debe volver al perfil anterior
                if (clearIgHistory) {
                    view.clearHistory();
                    clearIgHistory = false;
                }
            }
        });
        igView.setWebChromeClient(new WebChromeClient());
    }

    private static String profileUrl(String user) {
        return "https://www.instagram.com/" + Uri.encode(user) + "/";
    }

    private void openExternal(Uri url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    /** Métodos que la interfaz web llama como window.IGNative.metodo(...) */
    private class Bridge {

        @JavascriptInterface
        public void show(final String user, final double x, final double y, final double w, final double h) {
            runOnUiThread(() -> {
                float d = getResources().getDisplayMetrics().density;
                FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) igView.getLayoutParams();
                lp.leftMargin = (int) Math.round(x * d);
                lp.topMargin = (int) Math.round(y * d);
                lp.width = Math.max(1, (int) Math.round(w * d));
                lp.height = Math.max(1, (int) Math.round(h * d));
                igView.setLayoutParams(lp);
                if (!user.equals(igUser)) {
                    igUser = user;
                    clearIgHistory = true;
                    igView.loadUrl(profileUrl(user));
                }
                igView.setVisibility(View.VISIBLE);
            });
        }

        @JavascriptInterface
        public void hide() {
            runOnUiThread(() -> igView.setVisibility(View.GONE));
        }

        @JavascriptInterface
        public void back() {
            runOnUiThread(() -> {
                if (igView.canGoBack()) igView.goBack();
                else if (igUser != null) igView.loadUrl(profileUrl(igUser));
            });
        }

        @JavascriptInterface
        public void reload() {
            runOnUiThread(() -> igView.reload());
        }

        @JavascriptInterface
        public void toast(final String message) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void checkFollow(final String user) {
            runOnUiThread(() -> {
                if (!user.equals(igUser)) return;
                igView.evaluateJavascript(FOLLOW_STATE_JS, result -> appView.evaluateJavascript(
                        "window.onIgFollowState && window.onIgFollowState(" + JSONObject.quote(user) + "," + result + ")",
                        null));
            });
        }

        /** Guarda un archivo exportado en Descargas y devuelve dónde quedó ("" si falla). */
        @JavascriptInterface
        public String saveFile(String name, String mime, String content) {
            try {
                byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    values.put(MediaStore.Downloads.MIME_TYPE, mime);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) return "";
                    try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                        if (out == null) return "";
                        out.write(bytes);
                    }
                    return "Descargas/" + name;
                }
                File file = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), name);
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(bytes);
                }
                return file.getAbsolutePath();
            } catch (Exception e) {
                return "";
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_REQUEST || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null && data.getData() != null) {
            result = new Uri[]{data.getData()};
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // 1) La interfaz cierra diálogos o sale del modo; 2) el navegador de Instagram va atrás; 3) se cierra
        appView.evaluateJavascript("window.onNativeBack ? window.onNativeBack() : false", result -> {
            if ("true".equals(result)) return;
            if (igView.getVisibility() == View.VISIBLE && igView.canGoBack()) {
                igView.goBack();
                return;
            }
            finish();
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }
}
