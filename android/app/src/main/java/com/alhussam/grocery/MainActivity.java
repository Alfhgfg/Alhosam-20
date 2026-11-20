package com.alhussam.grocery;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {

    private boolean webViewBridgeAttached = false;
    private WebView activePrintWebView = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureWebView();
        registerBackHandler();
    }

    @Override
    public void onStart() {
        super.onStart();
        configureWebView();
    }

    private void registerBackHandler() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView == null) {
                    moveTaskToBack(true);
                    return;
                }
                webView.evaluateJavascript(
                    "(function(){if(typeof window.__ALHUSSAM_ON_ANDROID_BACK__==='function'){window.__ALHUSSAM_ON_ANDROID_BACK__();return 'handled';}return 'fallback';})()",
                    result -> {
                        if (result != null && result.contains("handled")) {
                            return;
                        }
                        if (webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            moveTaskToBack(true);
                        }
                    }
                );
            }
        });
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN && requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
            if (getBridge() == null) {
                return;
            }
            PluginHandle pluginHandle = getBridge().getPlugin("SocialLogin");
            if (pluginHandle == null) {
                return;
            }
            Plugin plugin = pluginHandle.getInstance();
            if (!(plugin instanceof SocialLoginPlugin)) {
                return;
            }
            ((SocialLoginPlugin) plugin).handleGoogleLoginIntent(requestCode, data);
        }
    }

    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}

    private void configureWebView() {
        if (this.bridge == null || this.bridge.getWebView() == null) {
            return;
        }
        WebView webView = this.bridge.getWebView();
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        if (!webViewBridgeAttached) {
            webView.addJavascriptInterface(new AndroidFileBridge(), "AndroidFileBridge");
            webView.addJavascriptInterface(new AndroidNavBridge(), "AndroidNavBridge");
            webView.addJavascriptInterface(new AndroidPrintBridge(), "AndroidPrintBridge");
            webViewBridgeAttached = true;
        }
    }

    private class AndroidPrintBridge {
        @JavascriptInterface
        public void printCurrentPage(final String jobName) {
            final String safeJobName = (jobName == null || jobName.trim().isEmpty())
                ? "بقالة الحسام - طباعة"
                : jobName.trim();

            runOnUiThread(() -> {
                try {
                    WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                    if (webView == null) return;
                    PrintManager printManager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                    if (printManager == null) {
                        Toast.makeText(MainActivity.this, "خدمة الطباعة غير متوفرة على هذا الجهاز.", Toast.LENGTH_LONG).show();
                        return;
                    }
                    printManager.print(
                        safeJobName,
                        webView.createPrintDocumentAdapter(safeJobName),
                        new PrintAttributes.Builder().build()
                    );
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "تعذر بدء الطباعة: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        }

        @JavascriptInterface
        public void printHtml(final String htmlContent, final String jobName) {
            if (htmlContent == null || htmlContent.trim().isEmpty()) return;
            final String safeJobName = (jobName == null || jobName.trim().isEmpty())
                ? "بقالة الحسام - ملصق باركود"
                : jobName.trim();

            runOnUiThread(() -> {
                try {
                    final WebView printView = new WebView(MainActivity.this);
                    printView.getSettings().setJavaScriptEnabled(false);
                    printView.getSettings().setDefaultTextEncodingName("UTF-8");
                    activePrintWebView = printView;

                    printView.setWebViewClient(new WebViewClient() {
                        @Override
                        public void onPageFinished(WebView view, String url) {
                            try {
                                PrintManager printManager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                                if (printManager == null) {
                                    Toast.makeText(MainActivity.this, "خدمة الطباعة غير متوفرة على هذا الجهاز.", Toast.LENGTH_LONG).show();
                                    return;
                                }
                                printManager.print(
                                    safeJobName,
                                    view.createPrintDocumentAdapter(safeJobName),
                                    new PrintAttributes.Builder().build()
                                );
                            } catch (Exception e) {
                                Toast.makeText(MainActivity.this, "تعذر بدء الطباعة: " + e.getMessage(), Toast.LENGTH_LONG).show();
                            }
                        }
                    });

                    printView.loadDataWithBaseURL(null, htmlContent, "text/html", "UTF-8", null);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "تعذر تجهيز مستند الطباعة: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        }
    }

    private class AndroidNavBridge {
        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(() -> finish());
        }

        @JavascriptInterface
        public void showExitHint(String message) {
            if (message == null || message.trim().isEmpty()) {
                return;
            }
            runOnUiThread(() ->
                Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show()
            );
        }
    }

    private class AndroidFileBridge {
        @JavascriptInterface
        public boolean saveFile(String base64Data, String fileName, String mimeType) {
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                String safeName = fileName.replaceAll("[\\\\/:*?\"<>|]", "_");

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                    values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/AlHussam");

                    ContentResolver resolver = getContentResolver();
                    Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) return false;
                    try (OutputStream out = resolver.openOutputStream(uri)) {
                        if (out == null) return false;
                        out.write(bytes);
                        out.flush();
                    }
                } else {
                    File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    File appDir = new File(downloadsDir, "AlHussam");
                    if (!appDir.exists()) {
                        appDir.mkdirs();
                    }
                    File outFile = new File(appDir, safeName);
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        fos.write(bytes);
                        fos.flush();
                    }
                }

                runOnUiThread(() ->
                    Toast.makeText(
                        MainActivity.this,
                        "تم حفظ الملف في مجلد التنزيلات (Downloads/AlHussam): " + safeName,
                        Toast.LENGTH_LONG
                    ).show()
                );
                return true;
            } catch (Exception e) {
                runOnUiThread(() ->
                    Toast.makeText(
                        MainActivity.this,
                        "تعذر حفظ الملف: " + e.getMessage(),
                        Toast.LENGTH_LONG
                    ).show()
                );
                return false;
            }
        }
    }
}
