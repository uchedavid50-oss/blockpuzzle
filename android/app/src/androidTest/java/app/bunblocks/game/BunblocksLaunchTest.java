package app.bunblocks.game;

import static org.junit.Assert.*;
import android.content.Context;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Run with emulator networking disabled to verify the packaged offline shell. */
@RunWith(AndroidJUnit4.class)
public class BunblocksLaunchTest {
    @Test public void packagedGameLaunches() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("app.bunblocks.game", context.getPackageName());
        String html;
        try (java.io.InputStream input = context.getAssets().open("public/index.html")) {
            html = new String(input.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        }
        assertFalse(html.contains("<script async src=\"https://pagead2"));
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            boolean ready = false;
            for (int attempt = 0; attempt < 40 && !ready; attempt++) {
                CountDownLatch done = new CountDownLatch(1);
                AtomicReference<String> value = new AtomicReference<>("");
                scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
                    "Boolean(document.querySelector('#game')?.getContext('2d').getImageData(100,100,1,1).data.slice(0,3).some(v => v > 0) && window.Capacitor?.isNativePlatform() && !document.querySelector('script[src*=adsbygoogle]'))",
                    result -> { value.set(result); done.countDown(); }));
                assertTrue(done.await(5, TimeUnit.SECONDS));
                ready = "true".equals(value.get());
                if (!ready) Thread.sleep(250);
            }
            assertTrue("Offline native canvas must launch without AdSense", ready);
        }
    }
}
