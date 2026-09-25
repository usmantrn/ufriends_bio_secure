void main() {
  Map<String, dynamic> json = {};
  try {
    var name = json['organization']?['name'] as String?;
    print("Success: $name");
  } catch (e) {
    print("Error: $e");
  }
}
