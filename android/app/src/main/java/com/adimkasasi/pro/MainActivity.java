package com.adimkasasi.pro;

import android.os.Bundle;
import com.adimkasasi.pro.steptracker.StepTrackerPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StepTrackerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
