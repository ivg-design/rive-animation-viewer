import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import AnswerSection from "@/components/AnswerSection";
import FeaturesSection from "@/components/FeaturesSection";
import GallerySection from "@/components/GallerySection";
import DownloadSection from "@/components/DownloadSection";
import ChangelogPreview from "@/components/ChangelogPreview";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <main className="flex flex-col items-center min-h-screen">
      <Header />
      <HeroSection />
      <AnswerSection />
      <FeaturesSection />
      <GallerySection />
      <DownloadSection />
      <ChangelogPreview />
      <Footer />
    </main>
  );
}
