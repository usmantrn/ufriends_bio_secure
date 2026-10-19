
import com.android.build.api.dsl.LibraryExtension
import com.android.build.api.dsl.ApplicationExtension

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

// ── Fix: dynamically align Kotlin JVM target with Java target per subproject ──
// Different plugins set different Java targets (tflite_flutter=11, camera=17).
// We read each library's compileOptions.targetCompatibility lazily via a provider
// and set Kotlin to match, avoiding hardcoded values that break other plugins.
// The :app module manages its own JVM target in app/build.gradle.kts.
subprojects {
    plugins.withId("com.android.library") {
        extensions.configure<com.android.build.api.dsl.LibraryExtension> {
            compileSdk = 36
        }
        val libExt = extensions.getByType<com.android.build.api.dsl.LibraryExtension>()
        tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
            compilerOptions {
                jvmTarget.set(provider {
                    val target = libExt.compileOptions.targetCompatibility?.toString() ?: "17"
                    org.jetbrains.kotlin.gradle.dsl.JvmTarget.fromTarget(target)
                })
            }
        }
    }
    plugins.withId("com.android.application") {
        extensions.configure<com.android.build.api.dsl.ApplicationExtension> {
            compileSdk = 36
        }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
